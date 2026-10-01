// Round trip: frames sent through the bridge must reach a Spout receiver unchanged.
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "SpoutDX.h"

extern "C" void* vtubeleaf_texture_start(const char* name);
extern "C" int vtubeleaf_texture_send(void* sender, const uint8_t* rgba, uint32_t width,
                                      uint32_t height);
extern "C" void vtubeleaf_texture_stop(void* sender);

int main() {
  const char* name = "VTubeLeaf Texture Test";
  const uint32_t width = 320, height = 180;
  void* sender = vtubeleaf_texture_start(name);
  if (!sender) {
    puts("SKIP: Direct3D 11 is unavailable");
    return 0;
  }
  // Opaque red on the top row, premultiplied 50% green below, transparent elsewhere.
  std::vector<uint8_t> frame(size_t{width} * height * 4);
  for (uint32_t x = 0; x < width; x++) {
    const uint8_t red[4] = {255, 0, 0, 255}, green[4] = {0, 128, 0, 128};
    memcpy(&frame[x * 4], red, 4);
    memcpy(&frame[(size_t{width} + x) * 4], green, 4);
  }
  if (vtubeleaf_texture_send(sender, frame.data(), width, height)) {
    puts("FAIL: could not send the first frame");
    return 1;
  }

  spoutDX receiver;
  receiver.SetReceiverName(name);
  std::vector<uint8_t> received(frame.size());
  bool matched = false;
  for (int attempt = 0; attempt < 200 && !matched; attempt++) {
    vtubeleaf_texture_send(sender, frame.data(), width, height);
    if (receiver.ReceiveImage(received.data(), width, height) && !receiver.IsUpdated())
      matched = receiver.GetSenderWidth() == width && receiver.GetSenderHeight() == height &&
                received == frame;
    Sleep(10);
  }
  if (!matched) {
    printf("FAIL: receiver saw %ux%u, first pixel %u %u %u %u\n", receiver.GetSenderWidth(),
           receiver.GetSenderHeight(), received[0], received[1], received[2], received[3]);
    return 1;
  }

  vtubeleaf_texture_stop(sender);
  bool closed = false;
  for (int attempt = 0; attempt < 200 && !closed; attempt++) {
    closed = !receiver.ReceiveImage(received.data(), width, height);
    Sleep(10);
  }
  receiver.ReleaseReceiver();
  if (!closed) {
    puts("FAIL: the sender stayed registered after stop");
    return 1;
  }
  puts("PASS");
  return 0;
}
