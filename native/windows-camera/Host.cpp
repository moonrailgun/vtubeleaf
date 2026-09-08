#include "Frame.h"
#include <cstdio>
#include <mutex>

namespace {
std::mutex guard;
camera::FrameChannel channel;
std::wstring dll64, dll32;
bool active = false;

bool registered(const std::wstring& dll, REGSAM view) {
    if (dll.empty() || GetFileAttributesW(dll.c_str()) == INVALID_FILE_ATTRIBUTES) return false;
    HKEY key;
    const auto path = std::wstring(L"Software\\Classes\\CLSID\\") + camera::ClassId + L"\\InprocServer32";
    if (RegOpenKeyExW(HKEY_CURRENT_USER, path.c_str(), 0, KEY_READ | view, &key) != ERROR_SUCCESS) return false;
    wchar_t value[32768]{};
    DWORD size = sizeof(value), type = 0;
    LSTATUS result = RegQueryValueExW(key, nullptr, nullptr, &type, reinterpret_cast<BYTE*>(value), &size);
    RegCloseKey(key);
    if (result != ERROR_SUCCESS || type != REG_SZ || size < 2 || size > sizeof(value) || value[size / 2 - 1] != 0) return false;
    if (_wcsicmp(value, dll.c_str()) != 0) return false;
    const auto instance = std::wstring(L"Software\\Classes\\CLSID\\") + camera::Category + L"\\Instance\\" + camera::ClassId;
    if (RegOpenKeyExW(HKEY_CURRENT_USER, instance.c_str(), 0, KEY_READ | view, &key) != ERROR_SUCCESS) return false;
    RegCloseKey(key);
    return true;
}
DWORD registration(const std::wstring& dll, bool x86, bool remove) {
    if (dll.empty() || dll.find(L'"') != std::wstring::npos || GetFileAttributesW(dll.c_str()) == INVALID_FILE_ATTRIBUTES) return ERROR_FILE_NOT_FOUND;
    wchar_t windows[32768];
    UINT size = GetWindowsDirectoryW(windows, ARRAYSIZE(windows));
    if (!size || size >= ARRAYSIZE(windows)) return ERROR_PATH_NOT_FOUND;
    const auto executable = std::wstring(windows) + (x86 ? L"\\SysWOW64\\regsvr32.exe" : L"\\System32\\regsvr32.exe");
    auto command = L"\"" + executable + L"\" /s " + (remove ? L"/u " : L"") + L"\"" + dll + L"\"";
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(executable.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) return GetLastError();
    camera::Handle thread, child;
    thread.reset(process.hThread); child.reset(process.hProcess);
    if (WaitForSingleObject(child.value, 15000) != WAIT_OBJECT_0) {
        TerminateProcess(child.value, ERROR_TIMEOUT);
        WaitForSingleObject(child.value, 1000);
        return ERROR_TIMEOUT;
    }
    DWORD result;
    return GetExitCodeProcess(child.value, &result) ? result : GetLastError();
}
}

extern "C" void vtubeleaf_camera_paths(const wchar_t* x64, const wchar_t* x86) {
    std::lock_guard<std::mutex> lock(guard);
    dll64 = x64 ? x64 : L"";
    dll32 = x86 ? x86 : L"";
}
extern "C" int vtubeleaf_camera_command(int operation, char* output, size_t capacity) {
    std::lock_guard<std::mutex> lock(guard);
    const char* message = nullptr;
    DWORD error = 0;
    if (operation == 2 || operation == 4) { channel.stop(); active = false; }
    if (operation == 1 || operation == 2) {
        // Registration is per user and touches only VTubeLeaf's own CLSID.
        error = registration(dll64, false, operation == 2);
        const DWORD second = registration(dll32, true, operation == 2);
        if (!error) error = second;
    }
    bool installed = registered(dll64, KEY_WOW64_64KEY) && registered(dll32, KEY_WOW64_32KEY);
    if (operation == 3 && !active) {
        if (!installed) { error = ERROR_NOT_READY; message = "Install VTubeLeaf Camera first."; }
        else if (!channel.start()) { error = ERROR_BUSY; message = "Camera is busy or its shared memory is unavailable."; }
        else active = true;
    }
    if (!message) message = error ? "Camera registration failed. Close camera apps and retry; check that both camera DLLs are bundled." :
        active ? "VTubeLeaf Camera is running (1280x720, 30 FPS). Select it in your meeting app." :
        installed ? "VTubeLeaf Camera is installed for this Windows user. Ready to start." :
        "Windows 10/11: install VTubeLeaf Camera for this user. No OBS or developer account required.";
    char detail[48]{};
    if (error) std::snprintf(detail, sizeof(detail), " Error: %lu", static_cast<unsigned long>(error));
    const int length = std::snprintf(output, capacity, "{\"supported\":true,\"installed\":%s,\"active\":%s,\"message\":\"%s%s\"}",
        installed ? "true" : "false", active ? "true" : "false", message, detail);
    return error || length < 0 || static_cast<size_t>(length) >= capacity ? -1 : 0;
}
extern "C" int vtubeleaf_camera_submit(const uint8_t* bytes, size_t length) {
    std::unique_lock<std::mutex> lock(guard, std::try_to_lock);
    if (!lock.owns_lock()) return 0; // Drop frames while a control operation owns the bridge.
    return active && channel.write(bytes, length) ? 0 : -1;
}
