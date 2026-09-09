#include "../Frame.h"
#include <baseclasses/streams.h>
#include <wrl/client.h>
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <vector>

using Microsoft::WRL::ComPtr;
extern "C" int vtubeleaf_camera_command(int, char*, size_t);
// Qedit's system Null Renderer; recent SDKs no longer ship Qedit.h.
constexpr CLSID NullRenderer = {0xc1f400a4, 0x3f08, 0x11d3, {0x9f, 0x0b, 0x00, 0x60, 0x08, 0x03, 0x9e, 0x37}};
#define CHECK(expression) do { if (!(expression)) { std::fprintf(stderr, "FAIL line %d: %s\n", __LINE__, #expression); std::exit(1); } } while (0)

void frames() {
    camera::FrameChannel receiver, sender, competitor;
    std::vector<uint8_t> input(camera::FrameBytes, 0), output(camera::FrameBytes, 99);
    auto black = [&] { return std::all_of(output.begin(), output.end(), [](uint8_t x) { return x == 0; }); };
    CHECK(!receiver.read(output.data(), output.size()) && black());
    CHECK(sender.start());
    CHECK(!competitor.start());
    CHECK(!receiver.read(output.data(), output.size()) && black());
    CHECK(!sender.write(input.data(), input.size() - 1));
    input[0] = 10; input[1] = 20; input[2] = 30;
    input[(camera::Height - 1) * camera::Width * 4] = 90;
    CHECK(sender.write(input.data(), input.size()));
    CHECK(receiver.read(output.data(), output.size()));
    size_t bottom = (camera::Height - 1) * camera::Width * 4;
    CHECK(output[bottom] == 30 && output[bottom + 1] == 20 && output[bottom + 2] == 10 && output[bottom + 3] == 255);
    CHECK(output[2] == 90); // bottom-up RGB32, with forced opaque alpha
    Sleep(550);
    CHECK(!receiver.read(output.data(), output.size()) && black());
    CHECK(sender.write(input.data(), input.size()));
    camera::UserSecurity security;
    camera::Handle mapping;
    mapping.reset(OpenFileMappingW(FILE_MAP_WRITE, FALSE, (security.prefix + L"data").c_str()));
    CHECK(mapping.value);
    auto* mapped = static_cast<camera::Frame*>(MapViewOfFile(mapping.value, FILE_MAP_WRITE, 0, 0, sizeof(camera::Frame)));
    CHECK(mapped);
    mapped->magic = 0;
    CHECK(!receiver.read(output.data(), output.size()) && black());
    mapped->magic = camera::Magic;
    UnmapViewOfFile(mapped);
    sender.stop();
    CHECK(!receiver.read(output.data(), output.size()) && black());
    CHECK(competitor.start()); // receiver retains mapping across producer restarts
    CHECK(competitor.write(input.data(), input.size()));
    CHECK(receiver.read(output.data(), output.size()) && output[2] == 90);
    competitor.stop();
}

int wmain(int argc, wchar_t** argv) {
    CHECK(argc == 2);
    CHECK(SUCCEEDED(CoInitializeEx(nullptr, COINIT_MULTITHREADED)));
    char status[1024]{};
    CHECK(vtubeleaf_camera_command(0, status, sizeof(status)) == 0);
    CHECK(std::strstr(status, "\"supported\":true,\"installed\":false,\"active\":false"));
    frames();
    HMODULE library = LoadLibraryW(argv[1]);
    CHECK(library);
    auto getClass = reinterpret_cast<HRESULT (STDAPICALLTYPE*)(REFCLSID, REFIID, void**)>(GetProcAddress(library, "DllGetClassObject"));
    auto install = reinterpret_cast<HRESULT (STDAPICALLTYPE*)()>(GetProcAddress(library, "DllRegisterServer"));
    auto uninstall = reinterpret_cast<HRESULT (STDAPICALLTYPE*)()>(GetProcAddress(library, "DllUnregisterServer"));
    CHECK(getClass && install && uninstall);
    CLSID id;
    CHECK(SUCCEEDED(CLSIDFromString(camera::ClassId, &id)));
    {
        ComPtr<IClassFactory> factory;
        CHECK(SUCCEEDED(getClass(id, IID_PPV_ARGS(&factory))));
        ComPtr<IBaseFilter> filter;
        CHECK(SUCCEEDED(factory->CreateInstance(nullptr, IID_PPV_ARGS(&filter))));
        ComPtr<IPin> pin;
        // CSource identifies its first pin as "1"; "Capture" is its display name.
        CHECK(SUCCEEDED(filter->FindPin(L"1", &pin)));
        ComPtr<IAMStreamConfig> config;
        CHECK(SUCCEEDED(pin.As(&config)));
        int count = 0, size = 0;
        CHECK(SUCCEEDED(config->GetNumberOfCapabilities(&count, &size)) && count == 1 && size == sizeof(VIDEO_STREAM_CONFIG_CAPS));
        VIDEO_STREAM_CONFIG_CAPS caps{};
        AM_MEDIA_TYPE* type = nullptr;
        CHECK(config->GetStreamCaps(-1, &type, reinterpret_cast<BYTE*>(&caps)) == S_FALSE && !type);
        CHECK(SUCCEEDED(config->GetStreamCaps(0, &type, reinterpret_cast<BYTE*>(&caps))));
        CHECK(type && type->lSampleSize == camera::FrameBytes && caps.MinOutputSize.cx == camera::Width);
        CHECK(SUCCEEDED(config->SetFormat(type)));
        ULONG original = type->cbFormat;
        type->cbFormat = 1;
        CHECK(FAILED(config->SetFormat(type)));
        type->cbFormat = original;
        CoTaskMemFree(type->pbFormat);
        if (type->pUnk) type->pUnk->Release();
        CoTaskMemFree(type);
        ComPtr<IKsPropertySet> properties;
        CHECK(SUCCEEDED(pin.As(&properties)));
        GUID category{}; DWORD returned = 0;
        CHECK(SUCCEEDED(properties->Get(AMPROPSETID_Pin, AMPROPERTY_PIN_CATEGORY, nullptr, 0, &category, sizeof(category), &returned)));
        CHECK(category == PIN_CATEGORY_CAPTURE && returned == sizeof(GUID));
        ComPtr<IGraphBuilder> graph;
        ComPtr<IBaseFilter> sink;
        CHECK(SUCCEEDED(CoCreateInstance(CLSID_FilterGraph, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&graph))));
        CHECK(SUCCEEDED(CoCreateInstance(NullRenderer, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&sink))));
        CHECK(SUCCEEDED(graph->AddFilter(filter.Get(), L"Camera")) && SUCCEEDED(graph->AddFilter(sink.Get(), L"Sink")));
        ComPtr<IPin> input;
        CHECK(SUCCEEDED(sink->FindPin(L"In", &input)));
        CHECK(SUCCEEDED(graph->ConnectDirect(pin.Get(), input.Get(), nullptr)));
        ComPtr<IMediaControl> control;
        CHECK(SUCCEEDED(graph.As(&control)) && SUCCEEDED(control->Run()));
        OAFilterState state;
        CHECK(SUCCEEDED(control->GetState(3000, &state)) && state == State_Running);
        Sleep(150);
        CHECK(SUCCEEDED(control->Stop()));
    }
    // This executable is intended for a disposable runner; preserve an existing installation.
    const auto key = std::wstring(L"Software\\Classes\\CLSID\\") + camera::ClassId;
    HKEY existing;
    CHECK(RegOpenKeyExW(HKEY_CURRENT_USER, key.c_str(), 0, KEY_READ, &existing) == ERROR_FILE_NOT_FOUND);
    CHECK(SUCCEEDED(install()));
    bool found = false;
    {
        ComPtr<ICreateDevEnum> devices;
        CHECK(SUCCEEDED(CoCreateInstance(CLSID_SystemDeviceEnum, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&devices))));
        ComPtr<IEnumMoniker> enumerator;
        if (devices->CreateClassEnumerator(CLSID_VideoInputDeviceCategory, &enumerator, 0) == S_OK) {
            ComPtr<IMoniker> moniker;
            while (enumerator->Next(1, &moniker, nullptr) == S_OK) {
                ComPtr<IPropertyBag> bag;
                VARIANT name; VariantInit(&name);
                if (SUCCEEDED(moniker->BindToStorage(nullptr, nullptr, IID_PPV_ARGS(&bag))) &&
                    SUCCEEDED(bag->Read(L"FriendlyName", &name, nullptr)) && name.vt == VT_BSTR &&
                    std::wcscmp(name.bstrVal, camera::Name) == 0) {
                    ComPtr<IBaseFilter> camera;
                    found = SUCCEEDED(moniker->BindToObject(nullptr, nullptr, IID_PPV_ARGS(&camera)));
                }
                VariantClear(&name);
                moniker.Reset();
            }
        }
    }
    // Uninstalling an old copy preserves a registration owned by another path.
    HKEY registration;
    CHECK(RegOpenKeyExW(HKEY_CURRENT_USER, (key + L"\\InprocServer32").c_str(), 0, KEY_SET_VALUE, &registration) == ERROR_SUCCESS);
    constexpr wchar_t otherCopy[] = L"C:\\OtherCopy\\VTubeLeafCamera.dll";
    CHECK(RegSetValueExW(registration, nullptr, 0, REG_SZ, reinterpret_cast<const BYTE*>(otherCopy), sizeof(otherCopy)) == ERROR_SUCCESS);
    RegCloseKey(registration);
    CHECK(SUCCEEDED(uninstall()));
    CHECK(RegOpenKeyExW(HKEY_CURRENT_USER, key.c_str(), 0, KEY_READ, &registration) == ERROR_SUCCESS);
    RegCloseKey(registration);
    CHECK(SUCCEEDED(install()) && SUCCEEDED(uninstall()));
    CHECK(found);
    FreeLibrary(library);
    CoUninitialize();
    std::puts("PASS: frames, isolation, restart, COM format, running graph, per-user enumeration and cleanup");
}
