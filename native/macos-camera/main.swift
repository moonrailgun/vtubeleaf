import Foundation
import CoreMediaIO
let cameraProvider = CameraProvider()
CMIOExtensionProvider.startService(provider: cameraProvider.provider)
CFRunLoopRun()
