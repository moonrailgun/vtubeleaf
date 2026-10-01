#include <cstdint>
#include <vector>

#include "SpoutDX.h"

namespace {
struct Sender {
  spoutDX spout;
  uint32_t width = 0, height = 0;
};
}  // namespace

extern "C" void* vtubeleaf_texture_start(const char* name) {
  auto sender = new Sender;
  // OpenDirectX11 reports success even when no device could be created.
  if (!sender->spout.OpenDirectX11() || !sender->spout.GetDX11Device()) {
    delete sender;
    return nullptr;
  }
  sender->spout.SetSenderName(name);
  // Frames arrive as RGBA; a matching shared texture avoids a per-frame channel swap.
  sender->spout.SetSenderFormat(DXGI_FORMAT_R8G8B8A8_UNORM);
  return sender;
}

// Publishes top-down premultiplied RGBA, the layout DirectX Spout senders use.
extern "C" int vtubeleaf_texture_send(void* handle, const uint8_t* rgba, uint32_t width,
                                      uint32_t height) {
  auto sender = static_cast<Sender*>(handle);
  if (!sender->spout.SendImage(rgba, width, height)) return 1;
  sender->width = width;
  sender->height = height;
  return 0;
}

// Spout2 has no reliable receiver count, so frames are always wanted.
extern "C" int vtubeleaf_texture_wanted(void*) { return 1; }

extern "C" void vtubeleaf_texture_stop(void* handle) {
  auto sender = static_cast<Sender*>(handle);
  if (sender->width) {
    // Receivers keep the last shared frame after a sender closes, so blank it first.
    std::vector<uint8_t> blank(size_t{sender->width} * sender->height * 4);
    sender->spout.SendImage(blank.data(), sender->width, sender->height);
  }
  sender->spout.ReleaseSender();
  sender->spout.CloseDirectX11();
  delete sender;
}
