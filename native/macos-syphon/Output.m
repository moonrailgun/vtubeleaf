#import <Accelerate/Accelerate.h>
#import <IOSurface/IOSurface.h>
#import "SyphonServerBase.h"

// Declared in Syphon's SyphonSubclassing.h, which also pulls in the unused client classes.
@interface SyphonServerBase (VTubeLeaf)
- (IOSurfaceRef)newSurfaceForWidth:(size_t)width height:(size_t)height options:(NSDictionary *)options;
- (void)publish;
@end

@interface VTubeLeafServer : SyphonServerBase {
 @public
  uint32_t width, height;
}
@end
@implementation VTubeLeafServer
@end

void *vtubeleaf_texture_start(const char *name) {
  @autoreleasepool {
    return (__bridge_retained void *)[[VTubeLeafServer alloc] initWithName:@(name) options:nil];
  }
}

// Publishes top-down premultiplied RGBA; Syphon surfaces are bottom-up BGRA. NULL pixels publish a blank frame.
int vtubeleaf_texture_send(void *handle, const uint8_t *rgba, uint32_t width, uint32_t height) {
  @autoreleasepool {
    VTubeLeafServer *server = (__bridge VTubeLeafServer *)handle;
    IOSurfaceRef surface = [server newSurfaceForWidth:width height:height options:nil];
    if (!surface) return 1;
    if (IOSurfaceLock(surface, 0, NULL) != kIOReturnSuccess) {
      CFRelease(surface);
      return 1;
    }
    vImage_Error error = kvImageNoError;
    if (rgba) {
      vImage_Buffer source = {(void *)rgba, height, width, (size_t)width * 4};
      vImage_Buffer target = {IOSurfaceGetBaseAddress(surface), height, width,
                              IOSurfaceGetBytesPerRow(surface)};
      const uint8_t bgra[4] = {2, 1, 0, 3};
      // The reflect cannot run in place; the channel swap can.
      error = vImageVerticalReflect_ARGB8888(&source, &target, kvImageNoFlags);
      if (error == kvImageNoError)
        error = vImagePermuteChannels_ARGB8888(&target, &target, bgra, kvImageNoFlags);
    } else {
      memset(IOSurfaceGetBaseAddress(surface), 0, IOSurfaceGetAllocSize(surface));
    }
    IOSurfaceUnlock(surface, 0, NULL);
    CFRelease(surface);
    if (error != kvImageNoError) return 1;
    server->width = width;
    server->height = height;
    [server publish];
    return 0;
  }
}

// Lets the app skip producing frames while no client is attached.
int vtubeleaf_texture_wanted(void *handle) {
  return ((__bridge VTubeLeafServer *)handle).hasClients;
}

void vtubeleaf_texture_stop(void *handle) {
  @autoreleasepool {
    VTubeLeafServer *server = (__bridge_transfer VTubeLeafServer *)handle;
    // Clients keep showing the last surface after a server retires, so blank it first.
    if (server->width) vtubeleaf_texture_send(handle, NULL, server->width, server->height);
    [server stop];
  }
}
