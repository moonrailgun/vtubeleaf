import Foundation
import CoreMedia
import CoreVideo

@main struct FrameChecks {
    static func main() throws {
        let frames = try CameraFrames()
        var rgba = [UInt8](repeating: 0, count: cameraBytes)
        rgba.replaceSubrange(0..<4, with: [240, 120, 30, 255])
        rgba.replaceSubrange((cameraBytes - 4)..<cameraBytes, with: [1, 2, 3, 255])
        let image = try rgba.withUnsafeBytes { try frames.pixelBuffer(rgba: $0.baseAddress!, count: $0.count) }
        assert(validCameraFrame(image))
        CVPixelBufferLockBaseAddress(image, .readOnly)
        let base = CVPixelBufferGetBaseAddress(image)!.assumingMemoryBound(to: UInt8.self)
        assert(Array(UnsafeBufferPointer(start: base, count: 4)) == [30, 120, 240, 255])
        let end = base.advanced(by: (cameraHeight - 1) * CVPixelBufferGetBytesPerRow(image) + (cameraWidth - 1) * 4)
        assert(Array(UnsafeBufferPointer(start: end, count: 4)) == [3, 2, 1, 255])
        CVPixelBufferUnlockBaseAddress(image, .readOnly)
        for count in [0, cameraBytes - 1, cameraBytes + 1] {
            do {
                _ = try rgba.withUnsafeBytes { try frames.pixelBuffer(rgba: $0.baseAddress!, count: count) }
                assertionFailure("Invalid frame length accepted")
            } catch {}
        }
        let blank = try frames.pixelBuffer()
        CVPixelBufferLockBaseAddress(blank, .readOnly)
        assert(CVPixelBufferGetBaseAddress(blank)!.assumingMemoryBound(to: UInt32.self)[0] == 0xff000000)
        CVPixelBufferUnlockBaseAddress(blank, .readOnly)
        assert(!frameIsFresh(received: 0, now: 1))
        assert(frameIsFresh(received: 1, now: 500_000_000))
        assert(!frameIsFresh(received: 1, now: 500_000_001))
        assert(!frameIsFresh(received: 20, now: 10))
        var wrong: CVPixelBuffer?
        assert(CVPixelBufferCreate(kCFAllocatorDefault, 16, 16, kCVPixelFormatType_32BGRA, nil, &wrong) == kCVReturnSuccess)
        assert(!validCameraFrame(wrong!))
        assert(CVPixelBufferCreate(kCFAllocatorDefault, cameraWidth, cameraHeight, kCVPixelFormatType_32ARGB, nil, &wrong) == kCVReturnSuccess)
        assert(!validCameraFrame(wrong!))
        let sample = try frames.sample(image, at: CMTime(value: 3, timescale: 1))
        assert(CMSampleBufferGetPresentationTimeStamp(sample).seconds == 3)
        var queue: CMSimpleQueue?
        assert(CMSimpleQueueCreate(allocator: kCFAllocatorDefault, capacity: 1, queueOut: &queue) == noErr)
        let token = Unmanaged.passRetained(sample).toOpaque()
        assert(CMSimpleQueueEnqueue(queue!, element: token) == noErr)
        assert(CMSimpleQueueGetCount(queue!) == 1)
        assert(CMSimpleQueueEnqueue(queue!, element: token) == kCMSimpleQueueError_QueueIsFull)
        let consumed = Unmanaged<CMSampleBuffer>.fromOpaque(CMSimpleQueueDequeue(queue!)!).takeRetainedValue()
        assert(CMSampleBufferGetImageBuffer(consumed) === image)
        assert(CMSimpleQueueGetCount(queue!) == 0)
        print("PASS: RGBA/BGRA conversion, row bounds, size/type rejection, opaque blank, stale timeout, sample timestamp, bounded queue and retain transfer")
    }
}
