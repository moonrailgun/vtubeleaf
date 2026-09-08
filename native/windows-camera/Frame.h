#pragma once
#include <windows.h>
#include <sddl.h>
#include <cstdint>
#include <cstring>
#include <string>

namespace camera {
constexpr int Width = 1280, Height = 720, Fps = 30;
constexpr size_t FrameBytes = Width * Height * 4;
constexpr uint32_t Magic = 0x564c4341, Version = 1;
constexpr wchar_t ClassId[] = L"{1789A10D-66F4-47AF-BEF1-872237DF2167}";
constexpr wchar_t Category[] = L"{860BB310-5D01-11D0-BD3B-00A0C911CE86}";
constexpr wchar_t Name[] = L"VTubeLeaf Camera";

// Fixed-width layout shared by the x86 filter and x64 producer. No pointers or size_t.
struct Frame {
    uint32_t magic, version;
    uint64_t writtenAt, sequence;
    uint32_t active, reserved;
    uint8_t pixels[FrameBytes];
};
static_assert(offsetof(Frame, pixels) == 32 && sizeof(Frame) == FrameBytes + 32);

class Handle {
public:
    HANDLE value = nullptr;
    Handle() = default;
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    ~Handle() { reset(); }
    void reset(HANDLE h = nullptr) { if (value) CloseHandle(value); value = h; }
};

// A logon-session namespace and explicit current-user ACL keep other users out.
class UserSecurity {
    PSECURITY_DESCRIPTOR descriptor = nullptr;
public:
    std::wstring prefix;
    SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, FALSE};
    UserSecurity() {
        Handle token;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token.value)) return;
        DWORD size = 0;
        GetTokenInformation(token.value, TokenUser, nullptr, 0, &size);
        if (!size || size > 65536) return;
        std::string buffer(size, '\0');
        if (!GetTokenInformation(token.value, TokenUser, buffer.data(), size, &size)) return;
        LPWSTR sid = nullptr;
        if (!ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(buffer.data())->User.Sid, &sid)) return;
        prefix = L"Local\\VTubeLeaf.Camera." + std::wstring(sid) + L".v1.";
        const auto acl = L"D:P(A;;GA;;;SY)(A;;GA;;;" + std::wstring(sid) + L")";
        LocalFree(sid);
        if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(acl.c_str(), SDDL_REVISION_1, &descriptor, nullptr)) {
            prefix.clear();
            return;
        }
        attributes.lpSecurityDescriptor = descriptor;
    }
    ~UserSecurity() { if (descriptor) LocalFree(descriptor); }
};

class FrameChannel {
    UserSecurity security;
    Handle mapping, mutex, producer;
    Frame* frame = nullptr;
    bool ownsProducer = false;
    bool lock() {
        if (!mutex.value) return false;
        DWORD result = WaitForSingleObject(mutex.value, 5);
        return result == WAIT_OBJECT_0 || result == WAIT_ABANDONED;
    }
    bool open(bool writing) {
        if (security.prefix.empty()) return false;
        mutex.reset(CreateMutexW(&security.attributes, FALSE, (security.prefix + L"frames").c_str()));
        if (!mutex.value) return false;
        mapping.reset(writing
            ? CreateFileMappingW(INVALID_HANDLE_VALUE, &security.attributes, PAGE_READWRITE, 0, sizeof(Frame), (security.prefix + L"data").c_str())
            : OpenFileMappingW(FILE_MAP_READ, FALSE, (security.prefix + L"data").c_str()));
        if (!mapping.value) return false;
        frame = static_cast<Frame*>(MapViewOfFile(mapping.value, writing ? FILE_MAP_WRITE : FILE_MAP_READ, 0, 0, sizeof(Frame)));
        return frame != nullptr;
    }
public:
    ~FrameChannel() { stop(); }
    bool start() {
        if (ownsProducer) return true;
        if (security.prefix.empty()) return false;
        // Only producers open this object. Closing/crashing releases the name even
        // while receivers retain the frame mapping; a new producer can restart.
        producer.reset(CreateMutexW(&security.attributes, FALSE, (security.prefix + L"producer").c_str()));
        const DWORD error = GetLastError();
        if (!producer.value || error == ERROR_ALREADY_EXISTS) { producer.reset(); return false; }
        if (!open(true) || !lock()) { stop(); return false; }
        std::memset(frame, 0, sizeof(Frame));
        frame->magic = Magic;
        frame->version = Version;
        frame->active = 1;
        ownsProducer = true;
        ReleaseMutex(mutex.value);
        return true;
    }
    bool write(const uint8_t* rgba, size_t length) {
        if (!ownsProducer || !rgba || length != FrameBytes) return false;
        if (!lock()) return true; // Drop a busy frame; never queue or block the UI.
        for (int y = 0; y < Height; ++y) {
            auto* dst = frame->pixels + (Height - 1 - y) * Width * 4;
            const auto* src = rgba + y * Width * 4;
            for (int x = 0; x < Width; ++x) {
                dst[x * 4] = src[x * 4 + 2];
                dst[x * 4 + 1] = src[x * 4 + 1];
                dst[x * 4 + 2] = src[x * 4];
                dst[x * 4 + 3] = 255;
            }
        }
        frame->writtenAt = GetTickCount64();
        ++frame->sequence;
        ReleaseMutex(mutex.value);
        return true;
    }
    bool read(uint8_t* destination, size_t length) {
        if (!destination || length != FrameBytes) return false;
        std::memset(destination, 0, FrameBytes);
        if (!frame && !open(false)) return false;
        if (!lock()) return false;
        const uint64_t now = GetTickCount64();
        const bool fresh = frame->magic == Magic && frame->version == Version &&
            frame->active == 1 && frame->sequence > 0 &&
            frame->writtenAt <= now && now - frame->writtenAt <= 500;
        if (fresh) std::memcpy(destination, frame->pixels, FrameBytes);
        ReleaseMutex(mutex.value);
        return fresh;
    }
    void stop() {
        if (ownsProducer && lock()) {
            frame->active = 0;
            std::memset(frame->pixels, 0, FrameBytes);
            ReleaseMutex(mutex.value);
        }
        ownsProducer = false;
        if (frame) UnmapViewOfFile(frame);
        frame = nullptr;
        mapping.reset();
        mutex.reset();
        producer.reset();
    }
};
}
