import Foundation
import CoreMedia
import CoreVideo
import Accelerate

let cameraWidth = 1280
let cameraHeight = 720
let cameraBytes = cameraWidth * cameraHeight * 4
let cameraDuration = CMTime(value: 1, timescale: 30)
let cameraIdentifier = "com.moonrailgun.vtubeleaf.camera"
let cameraDeviceUID = "com.moonrailgun.vtubeleaf.camera.device"

func cameraError(_ message: String) -> NSError {
    NSError(domain: cameraIdentifier, code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

func validCameraFrame(_ buffer: CVPixelBuffer) -> Bool {
    CVPixelBufferGetWidth(buffer) == cameraWidth && CVPixelBufferGetHeight(buffer) == cameraHeight &&
    CVPixelBufferGetPixelFormatType(buffer) == kCVPixelFormatType_32BGRA &&
    !CVPixelBufferIsPlanar(buffer) && CVPixelBufferGetBytesPerRow(buffer) >= cameraWidth * 4
}

func frameIsFresh(received: UInt64, now: UInt64) -> Bool {
    received > 0 && now >= received && now - received < 500_000_000
}

final class CameraFrames {
    let format: CMVideoFormatDescription
    let pool: CVPixelBufferPool
    init() throws {
        var description: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: kCVPixelFormatType_32BGRA,
            width: Int32(cameraWidth), height: Int32(cameraHeight), extensions: nil,
            formatDescriptionOut: &description) == noErr, let description else { throw cameraError("无法创建视频格式") }
        format = description
        var buffers: CVPixelBufferPool?
        let attributes: [CFString: Any] = [kCVPixelBufferWidthKey: cameraWidth, kCVPixelBufferHeightKey: cameraHeight,
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA, kCVPixelBufferIOSurfacePropertiesKey: [:]]
        guard CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attributes as CFDictionary, &buffers) == kCVReturnSuccess,
              let buffers else { throw cameraError("无法创建视频缓冲池") }
        pool = buffers
    }
    func pixelBuffer(rgba: UnsafeRawPointer? = nil, count: Int = 0) throws -> CVPixelBuffer {
        guard (rgba == nil && count == 0) || (rgba != nil && count == cameraBytes) else { throw cameraError("帧必须是 1280×720 RGBA") }
        var image: CVPixelBuffer?
        let limit = [kCVPixelBufferPoolAllocationThresholdKey: 4] as CFDictionary
        guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool, limit, &image) == kCVReturnSuccess,
              let image else { throw cameraError("视频缓冲池已满") }
        guard CVPixelBufferLockBaseAddress(image, []) == kCVReturnSuccess else { throw cameraError("无法锁定视频帧") }
        defer { CVPixelBufferUnlockBaseAddress(image, []) }
        guard let base = CVPixelBufferGetBaseAddress(image) else { throw cameraError("视频帧没有内存") }
        let stride = CVPixelBufferGetBytesPerRow(image)
        if let rgba {
            var source = vImage_Buffer(data: UnsafeMutableRawPointer(mutating: rgba), height: vImagePixelCount(cameraHeight), width: vImagePixelCount(cameraWidth), rowBytes: cameraWidth * 4)
            var target = vImage_Buffer(data: base, height: vImagePixelCount(cameraHeight), width: vImagePixelCount(cameraWidth), rowBytes: stride)
            let permutation: [UInt8] = [2, 1, 0, 3]
            guard vImagePermuteChannels_ARGB8888(&source, &target, permutation, vImage_Flags(kvImageNoFlags)) == kvImageNoError else { throw cameraError("视频颜色转换失败") }
        } else {
            for row in 0..<cameraHeight {
                let pixels = base.advanced(by: row * stride).assumingMemoryBound(to: UInt32.self)
                pixels.update(repeating: 0xff000000, count: cameraWidth)
            }
        }
        return image
    }
    func sample(_ image: CVPixelBuffer, at time: CMTime) throws -> CMSampleBuffer {
        guard validCameraFrame(image) else { throw cameraError("无效的视频帧格式") }
        var timing = CMSampleTimingInfo(duration: cameraDuration, presentationTimeStamp: time, decodeTimeStamp: .invalid)
        var buffer: CMSampleBuffer?
        guard CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: image, dataReady: true,
            makeDataReadyCallback: nil, refcon: nil, formatDescription: format, sampleTiming: &timing,
            sampleBufferOut: &buffer) == noErr, let buffer else { throw cameraError("无法创建视频采样") }
        return buffer
    }
}
