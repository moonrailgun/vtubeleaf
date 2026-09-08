#include "Frame.h"
#include <baseclasses/streams.h>
#include <initguid.h>
#include <chrono>
#include <thread>

// DirectShow's COM/filter/thread machinery is the MIT-licensed Microsoft
// BaseClasses implementation vendored below; only the camera policy lives here.
DEFINE_GUID(CLSID_VTubeLeafCamera, 0x1789a10d, 0x66f4, 0x47af, 0xbe, 0xf1, 0x87, 0x22, 0x37, 0xdf, 0x21, 0x67);

namespace {
bool accepts(const AM_MEDIA_TYPE* type) {
    if (!type || type->majortype != MEDIATYPE_Video || type->subtype != MEDIASUBTYPE_RGB32 ||
        type->formattype != FORMAT_VideoInfo || !type->pbFormat || type->cbFormat < sizeof(VIDEOINFOHEADER)) return false;
    const auto* video = reinterpret_cast<const VIDEOINFOHEADER*>(type->pbFormat);
    return video->bmiHeader.biSize == sizeof(BITMAPINFOHEADER) &&
        video->bmiHeader.biWidth == camera::Width && video->bmiHeader.biHeight == camera::Height &&
        video->bmiHeader.biPlanes == 1 && video->bmiHeader.biBitCount == 32 &&
        video->bmiHeader.biCompression == BI_RGB &&
        (video->AvgTimePerFrame == 0 || video->AvgTimePerFrame == 10000000 / camera::Fps);
}

HRESULT mediaType(CMediaType* type) {
    if (!type) return E_POINTER;
    auto* video = reinterpret_cast<VIDEOINFOHEADER*>(type->AllocFormatBuffer(sizeof(VIDEOINFOHEADER)));
    if (!video) return E_OUTOFMEMORY;
    ZeroMemory(video, sizeof(*video));
    video->AvgTimePerFrame = 10000000 / camera::Fps;
    video->dwBitRate = camera::FrameBytes * 8 * camera::Fps;
    video->bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    video->bmiHeader.biWidth = camera::Width;
    video->bmiHeader.biHeight = camera::Height;
    video->bmiHeader.biPlanes = 1;
    video->bmiHeader.biBitCount = 32;
    video->bmiHeader.biCompression = BI_RGB;
    video->bmiHeader.biSizeImage = camera::FrameBytes;
    type->SetType(&MEDIATYPE_Video);
    type->SetSubtype(&MEDIASUBTYPE_RGB32);
    type->SetFormatType(&FORMAT_VideoInfo);
    type->SetTemporalCompression(FALSE);
    type->SetSampleSize(camera::FrameBytes);
    return S_OK;
}

class CameraStream final : public CSourceStream, public IAMStreamConfig, public IKsPropertySet {
    camera::FrameChannel channel;
    uint64_t sampleIndex = 0;
    std::chrono::steady_clock::time_point next;
public:
    CameraStream(HRESULT* result, CSource* parent) : CSourceStream(NAME("VTubeLeaf Camera"), result, parent, L"Capture") {}
    DECLARE_IUNKNOWN;
    STDMETHODIMP NonDelegatingQueryInterface(REFIID iid, void** out) override {
        if (!out) return E_POINTER;
        if (iid == IID_IAMStreamConfig) return GetInterface(static_cast<IAMStreamConfig*>(this), out);
        if (iid == IID_IKsPropertySet) return GetInterface(static_cast<IKsPropertySet*>(this), out);
        return CSourceStream::NonDelegatingQueryInterface(iid, out);
    }
    HRESULT GetMediaType(CMediaType* type) override { return mediaType(type); }
    HRESULT CheckMediaType(const CMediaType* type) override { return accepts(type) ? S_OK : VFW_E_TYPE_NOT_ACCEPTED; }
    HRESULT DecideBufferSize(IMemAllocator* allocator, ALLOCATOR_PROPERTIES* properties) override {
        if (!allocator || !properties) return E_POINTER;
        properties->cBuffers = 2;
        properties->cbBuffer = camera::FrameBytes;
        properties->cbAlign = 1;
        properties->cbPrefix = 0;
        ALLOCATOR_PROPERTIES actual{};
        HRESULT result = allocator->SetProperties(properties, &actual);
        if (FAILED(result)) return result;
        return actual.cbBuffer >= properties->cbBuffer ? S_OK : E_FAIL;
    }
    HRESULT OnThreadCreate() override {
        sampleIndex = 0;
        next = std::chrono::steady_clock::now();
        return S_OK;
    }
    HRESULT FillBuffer(IMediaSample* sample) override {
        if (!sample) return E_POINTER;
        BYTE* pixels = nullptr;
        if (FAILED(sample->GetPointer(&pixels)) || !pixels || sample->GetSize() < camera::FrameBytes) return E_FAIL;
        std::this_thread::sleep_until(next);
        const auto now = std::chrono::steady_clock::now();
        next = (std::max)(next, now) + std::chrono::nanoseconds(1000000000 / camera::Fps);
        channel.read(pixels, camera::FrameBytes);
        // Rational timestamps avoid cumulative 33 ms rounding drift.
        REFERENCE_TIME start = sampleIndex * 10000000 / camera::Fps;
        REFERENCE_TIME end = (++sampleIndex) * 10000000 / camera::Fps;
        sample->SetTime(&start, &end);
        sample->SetActualDataLength(camera::FrameBytes);
        sample->SetSyncPoint(TRUE);
        sample->SetDiscontinuity(sampleIndex == 1);
        return S_OK;
    }
    STDMETHODIMP Notify(IBaseFilter*, Quality) override { return S_OK; }
    STDMETHODIMP SetFormat(AM_MEDIA_TYPE* type) override { return accepts(type) ? S_OK : VFW_E_TYPE_NOT_ACCEPTED; }
    STDMETHODIMP GetFormat(AM_MEDIA_TYPE** type) override {
        if (!type) return E_POINTER;
        *type = nullptr;
        CMediaType current;
        HRESULT result = mediaType(&current);
        if (FAILED(result)) return result;
        *type = CreateMediaType(&current);
        return *type ? S_OK : E_OUTOFMEMORY;
    }
    STDMETHODIMP GetNumberOfCapabilities(int* count, int* size) override {
        if (!count || !size) return E_POINTER;
        *count = 1; *size = sizeof(VIDEO_STREAM_CONFIG_CAPS);
        return S_OK;
    }
    STDMETHODIMP GetStreamCaps(int index, AM_MEDIA_TYPE** type, BYTE* data) override {
        if (!type || !data) return E_POINTER;
        *type = nullptr;
        if (index != 0) return S_FALSE;
        auto* caps = reinterpret_cast<VIDEO_STREAM_CONFIG_CAPS*>(data);
        ZeroMemory(caps, sizeof(*caps));
        caps->guid = FORMAT_VideoInfo;
        caps->InputSize = caps->MinCroppingSize = caps->MaxCroppingSize =
            caps->MinOutputSize = caps->MaxOutputSize = {camera::Width, camera::Height};
        caps->CropGranularityX = caps->CropGranularityY = caps->OutputGranularityX = caps->OutputGranularityY = 1;
        caps->MinFrameInterval = caps->MaxFrameInterval = 10000000 / camera::Fps;
        caps->MinBitsPerSecond = caps->MaxBitsPerSecond = camera::FrameBytes * 8 * camera::Fps;
        return GetFormat(type);
    }
    STDMETHODIMP Set(REFGUID, DWORD, LPVOID, DWORD, LPVOID, DWORD) override { return E_NOTIMPL; }
    STDMETHODIMP Get(REFGUID set, DWORD property, LPVOID, DWORD, LPVOID data, DWORD size, DWORD* returned) override {
        if (set != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
        if (property != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
        if (!data && !returned) return E_POINTER;
        if (returned) *returned = sizeof(GUID);
        if (data) {
            if (size < sizeof(GUID)) return E_UNEXPECTED;
            *static_cast<GUID*>(data) = PIN_CATEGORY_CAPTURE;
        }
        return S_OK;
    }
    STDMETHODIMP QuerySupported(REFGUID set, DWORD property, DWORD* support) override {
        if (!support) return E_POINTER;
        *support = 0;
        if (set != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
        if (property != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
        *support = KSPROPERTY_SUPPORT_GET;
        return S_OK;
    }
};

class CameraFilter final : public CSource {
    CameraStream* stream;
public:
    CameraFilter(IUnknown* outer, HRESULT* result) : CSource(NAME("VTubeLeaf Camera"), outer, CLSID_VTubeLeafCamera) {
        stream = new CameraStream(result, this);
    }
    STDMETHODIMP NonDelegatingQueryInterface(REFIID iid, void** out) override {
        if (iid == IID_IAMStreamConfig) return stream->NonDelegatingQueryInterface(iid, out);
        return CSource::NonDelegatingQueryInterface(iid, out);
    }
    static CUnknown* WINAPI Create(IUnknown* outer, HRESULT* result) {
        return new CameraFilter(outer, result);
    }
};

HMODULE module;
const auto classKey = std::wstring(L"Software\\Classes\\CLSID\\") + camera::ClassId;
const auto instanceKey = std::wstring(L"Software\\Classes\\CLSID\\") + camera::Category + L"\\Instance\\" + camera::ClassId;

LSTATUS setValue(const std::wstring& path, const wchar_t* name, const wchar_t* value) {
    HKEY key;
    LSTATUS result = RegCreateKeyExW(HKEY_CURRENT_USER, path.c_str(), 0, nullptr, 0, KEY_SET_VALUE, nullptr, &key, nullptr);
    if (result != ERROR_SUCCESS) return result;
    result = RegSetValueExW(key, name, 0, REG_SZ, reinterpret_cast<const BYTE*>(value), static_cast<DWORD>((wcslen(value) + 1) * sizeof(wchar_t)));
    RegCloseKey(key);
    return result;
}
}

CFactoryTemplate g_Templates[] = {{camera::Name, &CLSID_VTubeLeafCamera, CameraFilter::Create, nullptr, nullptr}};
int g_cTemplates = 1;
extern "C" BOOL WINAPI DllEntryPoint(HINSTANCE, ULONG, LPVOID);
BOOL APIENTRY DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
    if (reason == DLL_PROCESS_ATTACH) module = instance;
    return DllEntryPoint(instance, reason, reserved);
}

STDAPI DllUnregisterServer() {
    // An older app copy must not remove a newer copy's registration.
    wchar_t registered[32768]{}, current[32768];
    DWORD bytes = sizeof(registered);
    LSTATUS lookup = RegGetValueW(HKEY_CURRENT_USER, (classKey + L"\\InprocServer32").c_str(), nullptr,
        RRF_RT_REG_SZ, nullptr, registered, &bytes);
    if (lookup == ERROR_FILE_NOT_FOUND) return S_OK;
    if (lookup != ERROR_SUCCESS) return HRESULT_FROM_WIN32(lookup);
    DWORD size = GetModuleFileNameW(module, current, ARRAYSIZE(current));
    if (!size || size == ARRAYSIZE(current)) return E_FAIL;
    if (_wcsicmp(registered, current) != 0) return S_OK;
    LSTATUS first = RegDeleteTreeW(HKEY_CURRENT_USER, instanceKey.c_str());
    LSTATUS second = RegDeleteTreeW(HKEY_CURRENT_USER, classKey.c_str());
    if (first != ERROR_SUCCESS && first != ERROR_FILE_NOT_FOUND) return HRESULT_FROM_WIN32(first);
    return second == ERROR_FILE_NOT_FOUND ? S_OK : HRESULT_FROM_WIN32(second);
}
STDAPI DllRegisterServer() {
    wchar_t path[32768];
    DWORD size = GetModuleFileNameW(module, path, ARRAYSIZE(path));
    if (!size || size == ARRAYSIZE(path)) return E_FAIL;
    LSTATUS result = setValue(classKey, nullptr, camera::Name);
    if (!result) result = setValue(classKey + L"\\InprocServer32", nullptr, path);
    if (!result) result = setValue(classKey + L"\\InprocServer32", L"ThreadingModel", L"Both");
    if (!result) result = setValue(instanceKey, L"CLSID", camera::ClassId);
    if (!result) result = setValue(instanceKey, L"FriendlyName", camera::Name);
    if (result) DllUnregisterServer();
    return HRESULT_FROM_WIN32(result);
}
