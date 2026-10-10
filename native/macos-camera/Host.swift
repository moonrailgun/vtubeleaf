import Foundation
import AppKit
import CoreMediaIO
import SystemExtensions

private let hostQueue = DispatchQueue(label: "com.vtubeleaf.camera.host", qos: .userInteractive)
private let cameraHost = CameraHost()
// Index into tr's [en, zh, ja, es, fr]: first supported preferred language, else English (matches src-tauri/src/locale.rs). Tests pin it.
var hostLanguage = Locale.preferredLanguages.lazy
    .compactMap { tag in ["en", "zh", "ja", "es", "fr"].firstIndex(of: tag.prefix { $0 != "-" && $0 != "_" }.lowercased()) }
    .first ?? 0
private func tr(_ en: String, _ zh: String, _ ja: String, _ es: String, _ fr: String) -> String {
    [en, zh, ja, es, fr][hostLanguage]
}
private let cameraDeviceUnavailable: String = {
    if #available(macOS 15, *) {
        return tr(
            "The camera extension is enabled, but the camera isn’t ready yet. This can happen after an app update. Open “Camera Extensions”, quit VTubeLeaf, turn VTubeLeaf Camera off and back on, then reopen VTubeLeaf and try again.",
            "相机扩展已启用，但摄像头尚未就绪。更新应用后可能出现此情况。请先打开「相机扩展」，退出 VTubeLeaf，将 VTubeLeaf Camera 关闭后重新开启，再打开 VTubeLeaf 重试。",
            "カメラ拡張機能は有効ですが、カメラの準備がまだできていません。アプリの更新後に起こることがあります。「カメラ拡張機能」を開き、VTubeLeaf を終了して VTubeLeaf Camera をオフにしてから再びオンにし、VTubeLeaf を開き直してもう一度お試しください。",
            "La extensión de cámara está activada, pero la cámara aún no está lista. Puede pasar tras actualizar la app. Abre “Extensiones de cámara”, cierra VTubeLeaf, desactiva y vuelve a activar VTubeLeaf Camera, y luego abre VTubeLeaf e inténtalo de nuevo.",
            "L’extension de caméra est activée, mais la caméra n’est pas encore prête. Cela peut arriver après une mise à jour de l’appli. Ouvrez « Extensions de caméra », quittez VTubeLeaf, désactivez puis réactivez VTubeLeaf Camera, puis rouvrez VTubeLeaf et réessayez.")
    }
    return tr(
        "The camera extension is enabled, but the camera isn’t ready yet. Quit and reopen VTubeLeaf, then try again.",
        "相机扩展已启用，但摄像头尚未就绪。请尝试退出并重新打开 VTubeLeaf 后重试。",
        "カメラ拡張機能は有効ですが、カメラの準備がまだできていません。VTubeLeaf を終了して開き直してから、もう一度お試しください。",
        "La extensión de cámara está activada, pero la cámara aún no está lista. Cierra y vuelve a abrir VTubeLeaf, y vuelve a intentarlo.",
        "L’extension de caméra est activée, mais la caméra n’est pas encore prête. Quittez et rouvrez VTubeLeaf, puis réessayez.")
}()
private let cameraRebootRequired = tr(
    "macOS needs to restart to finish changing the camera extension; save your work and restart your Mac",
    "macOS 要求重启以完成摄像头扩展变更；请保存工作并重启 Mac",
    "カメラ拡張機能の変更を完了するには macOS の再起動が必要です。作業を保存して Mac を再起動してください",
    "macOS necesita reiniciarse para completar el cambio de la extensión de cámara; guarda tu trabajo y reinicia el Mac",
    "macOS doit redémarrer pour terminer la modification de l’extension de caméra ; enregistrez votre travail et redémarrez le Mac")
private let cameraNotInstalled = tr("VTubeLeaf Camera isn’t installed yet", "尚未安装 VTubeLeaf Camera", "VTubeLeaf Camera はまだインストールされていません", "VTubeLeaf Camera aún no está instalada", "VTubeLeaf Camera n’est pas encore installée")

func objectIDs(_ object: CMIOObjectID, _ selector: CMIOObjectPropertySelector, scope: CMIOObjectPropertyScope = CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal)) -> [CMIOObjectID] {
    var address = CMIOObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var size: UInt32 = 0
    guard CMIOObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr,
          size > 0, size <= 65536, size % 4 == 0 else { return [] }
    var result = [CMIOObjectID](repeating: 0, count: Int(size) / 4)
    let status = result.withUnsafeMutableBytes { CMIOObjectGetPropertyData(object, &address, 0, nil, size, &size, $0.baseAddress!) }
    return status == noErr ? Array(result.prefix(Int(size) / 4)) : []
}

func deviceUID(_ device: CMIODeviceID) -> String? {
    var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceUID), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout.size(ofValue: value))
    guard CMIOObjectGetPropertyData(device, &address, 0, nil, size, &size, &value) == noErr else { return nil }
    return value?.takeRetainedValue() as String?
}

func cameraBufferQueue(_ stream: CMIOStreamID) throws -> CMSimpleQueue {
    var value: Unmanaged<CMSimpleQueue>?
    // A nil callback unregisters notifications and can return noErr with a nil queue.
    // Frame submission polls the queue, so no callback work is needed.
    let result = CMIOStreamCopyBufferQueue(stream, { _, _, _ in }, nil, &value)
    guard result == noErr, let queue = value?.takeRetainedValue(), CMSimpleQueueGetCapacity(queue) > 0 else { throw cameraError(tr("Couldn’t open the camera queue: \(result)", "无法打开摄像头队列：\(result)", "カメラのキューを開けません：\(result)", "No se pudo abrir la cola de la cámara: \(result)", "Impossible d’ouvrir la file de la caméra : \(result)")) }
    return queue
}

class CameraHost: NSObject, OSSystemExtensionRequestDelegate {
    var installed = false
    var message = cameraNotInstalled
    var device: CMIODeviceID = 0
    var stream: CMIOStreamID = 0
    var queue: CMSimpleQueue?
    var frames: CameraFrames?
    var requests: [ObjectIdentifier: String] = [:]
    var lastEnqueue: UInt64 = 0
    var lastRefresh: UInt64 = 0
    var approvalPromptShown = false
    var waitingForDevice = false
    var startAfterActivation = false
    var activationCompleted = false
    var needsReboot = false
    var deviceWaitDeadline: UInt64?
    var uninstallAfterRequest = false
    var extensionBundleURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Library/SystemExtensions/\(cameraIdentifier).systemextension")

    func showApprovalPrompt() {
        if #available(macOS 15, *) {
            message = tr("Turn on VTubeLeaf Camera in “Camera Extensions”", "请在「相机扩展」中开启 VTubeLeaf Camera", "「カメラ拡張機能」で VTubeLeaf Camera をオンにしてください", "Activa VTubeLeaf Camera en “Extensiones de cámara”", "Activez VTubeLeaf Camera dans « Extensions de caméra »")
        } else {
            message = tr("Allow the VTubeLeaf Camera extension in System Settings → Privacy & Security", "请在系统设置 → 隐私与安全性中允许 VTubeLeaf Camera 扩展", "システム設定 → プライバシーとセキュリティで VTubeLeaf Camera 拡張機能を許可してください", "Permite la extensión VTubeLeaf Camera en Ajustes del Sistema → Privacidad y seguridad", "Autorisez l’extension VTubeLeaf Camera dans Réglages Système → Confidentialité et sécurité")
        }
        guard !approvalPromptShown else { return }
        approvalPromptShown = true
        showSettingsPrompt(
            title: tr("VTubeLeaf Camera needs to be enabled", "需要启用 VTubeLeaf Camera", "VTubeLeaf Camera を有効にする必要があります", "Hay que activar VTubeLeaf Camera", "VTubeLeaf Camera doit être activée"),
            instructions: message + tr(
                ". Once it’s on, come back to the app and the pending start will continue automatically.",
                "。开启后回到应用，待处理的启动会自动继续。",
                "。オンにしてアプリに戻ると、保留中の開始処理が自動で続行されます。",
                ". Cuando esté activada, vuelve a la app y el inicio pendiente continuará automáticamente.",
                ". Une fois activée, revenez dans l’appli : le démarrage en attente reprendra automatiquement."))
    }

    func showSettingsPrompt(title: String, instructions: String) {
        let settingsURL: String
        let buttonTitle: String
        if #available(macOS 15, *) {
            settingsURL = "x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.system_extension.cmio.extension-point"
            buttonTitle = tr("Open Camera Extensions", "打开相机扩展", "カメラ拡張機能を開く", "Abrir Extensiones de cámara", "Ouvrir Extensions de caméra")
        } else {
            settingsURL = "x-apple.systempreferences:com.apple.preference.security"
            buttonTitle = tr("Open Privacy & Security", "打开隐私与安全性", "プライバシーとセキュリティを開く", "Abrir Privacidad y seguridad", "Ouvrir Confidentialité et sécurité")
        }
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = title
            alert.informativeText = instructions
            alert.addButton(withTitle: buttonTitle)
            alert.addButton(withTitle: tr("Later", "稍后", "後で", "Más tarde", "Plus tard"))
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(URL(string: settingsURL)!)
            }
        }
    }

    func findDevice() -> CMIODeviceID? {
        objectIDs(CMIOObjectID(kCMIOObjectSystemObject), CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices)).first { deviceUID($0) == cameraDeviceUID }
    }
    func hasConsumers() -> Bool? {
        guard device != 0 else { return nil }
        // `vlcs` is the extension's source-client property; older extensions omit it.
        var address = CMIOObjectPropertyAddress(mSelector: 0x766c6373, mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        guard CMIOObjectHasProperty(device, &address) else { return nil }
        var value: Unmanaged<CFString>?
        var size = UInt32(MemoryLayout.size(ofValue: value))
        guard CMIOObjectGetPropertyData(device, &address, 0, nil, size, &size, &value) == noErr,
              let value = value?.takeRetainedValue() as String? else { return nil }
        switch value {
        case "0": return false
        case "1": return true
        default: return nil
        }
    }
    func updateInstallation(enabled: Bool, deviceAvailable: Bool?) {
        let wasInstalled = installed
        installed = enabled
        guard !needsReboot, !startAfterActivation else { return }
        if !installed && wasInstalled {
            stop()
            waitingForDevice = false
            message = tr("The camera extension was turned off. Turn it back on in System Settings or reinstall it", "摄像头扩展已停用，请在系统设置中重新开启或安装", "カメラ拡張機能が無効になりました。システム設定で再度オンにするか、インストールし直してください", "La extensión de cámara se desactivó. Vuelve a activarla en Ajustes del Sistema o reinstálala", "L’extension de caméra a été désactivée. Réactivez-la dans Réglages Système ou réinstallez-la")
        } else if installed && stream == 0 && (!wasInstalled || waitingForDevice) {
            waitingForDevice = deviceAvailable == false
            if let deviceAvailable {
                message = deviceAvailable ? tr("Camera installed. Ready to start output", "摄像头已安装，可以启动输出", "カメラをインストールしました。出力を開始できます", "Cámara instalada. Ya puedes iniciar la salida", "Caméra installée. Vous pouvez lancer la sortie") : cameraDeviceUnavailable
            } else {
                message = tr("Camera extension enabled. The device will be checked when output starts", "摄像头扩展已启用，启动输出时将检查设备", "カメラ拡張機能は有効です。出力の開始時にデバイスを確認します", "Extensión de cámara activada. El dispositivo se comprobará al iniciar la salida", "Extension de caméra activée. L’appareil sera vérifié au lancement de la sortie")
            }
        }
    }
    func snapshot() -> [String: Any] {
        let now = DispatchTime.now().uptimeNanoseconds
        advanceStart(now: now)
        if stream != 0 && findDevice() != device {
            stop()
            message = tr("Virtual camera disconnected. Restart output", "虚拟摄像头已断开，请重新启动输出", "仮想カメラが切断されました。出力を開始し直してください", "La cámara virtual se desconectó. Vuelve a iniciar la salida", "Caméra virtuelle déconnectée. Relancez la sortie")
        }
        if now - lastRefresh > 2_000_000_000 && requests.isEmpty && !startAfterActivation {
            lastRefresh = now
            request("status")
        }
        var result: [String: Any] = ["supported": true, "installed": installed, "active": stream != 0, "message": message]
        if stream != 0, let consumers = hasConsumers() { result["consumers"] = consumers }
        return result
    }
    func request(_ kind: String) {
        if kind == "install" && startAfterActivation { return }
        if kind == "uninstall" {
            guard !requests.values.contains("uninstall") else { return }
            stop()
        }
        if kind != "status" && requests.values.contains(where: { $0 != "status" }) {
            if kind == "uninstall" {
                uninstallAfterRequest = true
                message = tr("The camera extension will be uninstalled once the current request finishes", "当前请求完成后将自动卸载摄像头扩展", "現在のリクエストが終わると、カメラ拡張機能を自動でアンインストールします", "La extensión de cámara se desinstalará al terminar la solicitud actual", "L’extension de caméra sera désinstallée à la fin de la demande en cours")
            } else if kind != "start" { message = tr("A system extension request is in progress. Try again when it’s done", "系统扩展请求正在处理中，请完成后重试", "システム拡張機能のリクエストを処理中です。完了してからもう一度お試しください", "Hay una solicitud de extensión del sistema en curso. Inténtalo de nuevo cuando termine", "Une demande d’extension système est en cours. Réessayez une fois terminée") }
            return
        }
        if kind == "install" || kind == "start" {
            guard FileManager.default.fileExists(atPath: extensionBundleURL.path) else {
                startAfterActivation = false
                message = tr("The app package is missing the camera extension. Build a signed package first", "安装包缺少摄像头扩展，请先完成签名打包", "アプリパッケージにカメラ拡張機能が含まれていません。先に署名付きでパッケージ化してください", "Al paquete de la app le falta la extensión de cámara. Primero genera un paquete firmado", "Le paquet de l’appli ne contient pas l’extension de caméra. Créez d’abord un paquet signé"); return
            }
            approvalPromptShown = false
        }
        if kind == "start" {
            startAfterActivation = true
            waitingForDevice = false
        }
        // Pre-change status results are obsolete even if they arrive after this request finishes.
        if kind != "status" {
            requests = requests.filter { $0.value != "status" }
            activationCompleted = false
        }
        let request: OSSystemExtensionRequest
        switch kind {
        case "install", "start": request = .activationRequest(forExtensionWithIdentifier: cameraIdentifier, queue: hostQueue)
        case "uninstall": request = .deactivationRequest(forExtensionWithIdentifier: cameraIdentifier, queue: hostQueue)
        default: request = .propertiesRequest(forExtensionWithIdentifier: cameraIdentifier, queue: hostQueue)
        }
        requests[ObjectIdentifier(request)] = kind
        request.delegate = self
        switch kind {
        case "install": message = tr("Requesting installation. Approve the extension in System Settings", "正在请求安装，请在系统设置中批准扩展", "インストールをリクエストしています。システム設定で拡張機能を承認してください", "Solicitando la instalación. Aprueba la extensión en Ajustes del Sistema", "Demande d’installation en cours. Approuvez l’extension dans Réglages Système")
        case "start": message = tr("Checking and updating the camera extension", "正在检查并更新摄像头扩展", "カメラ拡張機能を確認・更新しています", "Comprobando y actualizando la extensión de cámara", "Vérification et mise à jour de l’extension de caméra")
        case "uninstall": message = tr("Requesting camera extension uninstall", "正在请求卸载摄像头扩展", "カメラ拡張機能のアンインストールをリクエストしています", "Solicitando la desinstalación de la extensión de cámara", "Demande de désinstallation de l’extension de caméra")
        default: break
        }
        submitRequest(request)
    }
    func submitRequest(_ request: OSSystemExtensionRequest) {
        OSSystemExtensionManager.shared.submitRequest(request)
    }
    func start() throws {
        if stream != 0 { return }
        guard !needsReboot else { message = cameraRebootRequired; return }
        guard !startAfterActivation,
              !requests.values.contains(where: { $0 != "status" }) else { return }
        // Activation also checks/replaces an installed version; never open its stream first.
        request("start")
    }
    func advanceStart(now: UInt64) {
        guard startAfterActivation, let deadline = deviceWaitDeadline else { return }
        if findDevice() != nil {
            deviceWaitDeadline = nil
            startAfterActivation = false
            waitingForDevice = false
            do { try startStream() }
            catch { message = error.localizedDescription }
        } else if now >= deadline {
            deviceWaitDeadline = nil
            startAfterActivation = false
            message = cameraDeviceUnavailable
            showSettingsPrompt(
                title: tr("Virtual camera unavailable for now", "虚拟摄像头暂时无法使用", "仮想カメラを一時的に使用できません", "La cámara virtual no está disponible por ahora", "Caméra virtuelle momentanément indisponible"),
                instructions: message + tr(
                    "\n\nIf that doesn’t help, uninstall and reinstall the virtual camera in the app. If macOS asks for a restart, restart your Mac.",
                    "\n\n若仍无法恢复，可在应用中卸载并重新安装虚拟摄像头；若 macOS 提示需要重启，请重启 Mac。",
                    "\n\nそれでも直らない場合は、アプリで仮想カメラをアンインストールしてから再インストールしてください。macOS から再起動を求められた場合は、Mac を再起動してください。",
                    "\n\nSi sigue sin funcionar, desinstala y vuelve a instalar la cámara virtual desde la app. Si macOS pide reiniciar, reinicia el Mac.",
                    "\n\nSi le problème persiste, désinstallez puis réinstallez la caméra virtuelle depuis l’appli. Si macOS demande un redémarrage, redémarrez le Mac."))
        }
    }
    func startStream() throws {
        if stream != 0 { return }
        guard let device = findDevice() else {
            waitingForDevice = installed
            throw cameraError(installed
                ? cameraDeviceUnavailable
                : tr(
                    "VTubeLeaf Camera not found. Install it and enable the camera extension in System Settings first",
                    "找不到 VTubeLeaf Camera，请先安装并在系统设置中启用相机扩展",
                    "VTubeLeaf Camera が見つかりません。先にインストールし、システム設定でカメラ拡張機能を有効にしてください",
                    "No se encuentra VTubeLeaf Camera. Primero instálala y activa la extensión de cámara en Ajustes del Sistema",
                    "VTubeLeaf Camera introuvable. Installez-la d’abord et activez l’extension de caméra dans Réglages Système"))
        }
        waitingForDevice = false
        let outputs = objectIDs(device, CMIOObjectPropertySelector(kCMIODevicePropertyStreams), scope: CMIOObjectPropertyScope(kCMIODevicePropertyScopeOutput))
        guard let stream = outputs.first, outputs.count == 1 else { throw cameraError(tr("Camera input stream not found", "找不到摄像头输入流", "カメラの入力ストリームが見つかりません", "No se encuentra el flujo de entrada de la cámara", "Flux d’entrée de la caméra introuvable")) }
        let queue = try cameraBufferQueue(stream)
        let frames = try CameraFrames()
        let status = CMIODeviceStartStream(device, stream)
        guard status == noErr else { throw cameraError(tr("Couldn’t start the camera input stream: \(status)", "无法启动摄像头输入流：\(status)", "カメラの入力ストリームを開始できません：\(status)", "No se pudo iniciar el flujo de entrada de la cámara: \(status)", "Impossible de démarrer le flux d’entrée de la caméra : \(status)")) }
        self.device = device; self.stream = stream; self.queue = queue; self.frames = frames
        installed = true; lastEnqueue = 0; message = tr("Outputting 1280×720 / 30 FPS", "正在输出 1280×720 / 30 FPS", "1280×720 / 30 FPS で出力中", "Emitiendo 1280×720 / 30 FPS", "Sortie en 1280×720 / 30 FPS")
    }
    func stop() {
        startAfterActivation = false
        deviceWaitDeadline = nil
        if stream != 0 { CMIODeviceStopStream(device, stream) }
        // CMIO owns buffers after enqueue; do not race its consumer by draining/resetting its queue.
        queue = nil; frames = nil; stream = 0; device = 0; lastEnqueue = 0
        message = needsReboot ? cameraRebootRequired : (installed ? tr("Camera installed. Output stopped", "摄像头已安装，输出已停止", "カメラはインストール済みです。出力を停止しました", "Cámara instalada. Salida detenida", "Caméra installée. Sortie arrêtée") : cameraNotInstalled)
    }
    func submit(_ bytes: UnsafeRawPointer, count: Int) throws {
        guard count == cameraBytes else { throw cameraError(tr("Frames must be 1280×720 RGBA", "帧必须是 1280×720 RGBA", "フレームは 1280×720 RGBA である必要があります", "Los fotogramas deben ser 1280×720 RGBA", "Les images doivent être en 1280×720 RGBA")) }
        guard stream != 0, let queue, let frames else { throw cameraError(tr("Camera output hasn’t started", "摄像头输出尚未启动", "カメラ出力がまだ開始されていません", "La salida de la cámara aún no se ha iniciado", "La sortie caméra n’a pas encore démarré")) }
        let now = DispatchTime.now().uptimeNanoseconds
        if CMSimpleQueueGetCount(queue) > 0 {
            if lastEnqueue > 0 && now - lastEnqueue > 2_000_000_000 {
                stop(); throw cameraError(tr("Camera input stream timed out. Restart output", "摄像头输入流超时，请重新启动输出", "カメラの入力ストリームがタイムアウトしました。出力を開始し直してください", "Se agotó el tiempo del flujo de entrada de la cámara. Vuelve a iniciar la salida", "Le flux d’entrée de la caméra a expiré. Relancez la sortie"))
            }
            return // One native frame in flight; drop newer frames while CMIO consumes it.
        }
        // No time gate: the extension takes one frame per 30 FPS tick, so the check above already caps
        // the rate. A second 33.3 ms gate dropped about every other frame paced by the app's jittery loop.
        let image = try frames.pixelBuffer(rgba: bytes, count: count)
        let sample = try frames.sample(image, at: CMClockGetTime(CMClockGetHostTimeClock()))
        let retained = Unmanaged.passRetained(sample)
        let status = CMSimpleQueueEnqueue(queue, element: retained.toOpaque())
        if status != noErr {
            retained.release()
            throw cameraError(tr("Couldn’t queue the camera frame: \(status)", "摄像头帧入队失败：\(status)", "カメラフレームをキューに追加できません：\(status)", "No se pudo poner en cola el fotograma de la cámara: \(status)", "Impossible de mettre l’image de la caméra en file : \(status)"))
        }
        lastEnqueue = now
    }
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        guard requests[ObjectIdentifier(request)] != nil, !uninstallAfterRequest else { return }
        showApprovalPrompt()
    }
    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction { .replace }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        guard let kind = requests.removeValue(forKey: ObjectIdentifier(request)), kind != "status" else { return }
        if result == .willCompleteAfterReboot {
            startAfterActivation = false
            needsReboot = true
        }
        if uninstallAfterRequest {
            uninstallAfterRequest = false
            self.request("uninstall")
            return
        }
        if kind == "install" || kind == "start" {
            activationCompleted = result == .completed && !needsReboot
            // Refresh readiness even if earlier status already marked the extension installed.
            if kind == "install" && activationCompleted && stream == 0 { waitingForDevice = true }
            updateInstallation(enabled: true, deviceAvailable: activationCompleted ? findDevice() != nil : nil)
        }
        if kind == "uninstall" { updateInstallation(enabled: false, deviceAvailable: false); message = tr("Camera uninstalled", "摄像头已卸载", "カメラをアンインストールしました", "Cámara desinstalada", "Caméra désinstallée") }
        if needsReboot {
            message = cameraRebootRequired
            return
        }
        if kind == "start" && startAfterActivation {
            let now = DispatchTime.now().uptimeNanoseconds
            deviceWaitDeadline = now + 8_000_000_000
            waitingForDevice = true
            message = tr("Waiting for the camera device. Output will start automatically", "正在等待摄像头设备就绪，将自动启动输出", "カメラデバイスの準備を待っています。準備ができると自動で出力を開始します", "Esperando a que el dispositivo de cámara esté listo. La salida se iniciará automáticamente", "En attente de l’appareil caméra. La sortie démarrera automatiquement")
            advanceStart(now: now)
        }
    }
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        guard let kind = requests.removeValue(forKey: ObjectIdentifier(request)) else { return }
        if kind != "status" {
            startAfterActivation = false
            deviceWaitDeadline = nil
            waitingForDevice = false
            if uninstallAfterRequest {
                uninstallAfterRequest = false
                self.request("uninstall")
                return
            }
        }
        if needsReboot {
            message = kind == "status" ? cameraRebootRequired : tr("System extension: \(error.localizedDescription). \(cameraRebootRequired)", "系统扩展：\(error.localizedDescription)。\(cameraRebootRequired)", "システム拡張機能：\(error.localizedDescription)。\(cameraRebootRequired)", "Extensión del sistema: \(error.localizedDescription). \(cameraRebootRequired)", "Extension système : \(error.localizedDescription). \(cameraRebootRequired)")
            return
        }
        guard !requests.values.contains(where: { $0 != "status" }),
              !startAfterActivation else { return }
        // A bare development executable may not be entitled to inspect system extensions.
        if kind != "status" || !installed { message = tr("System extension: \(error.localizedDescription)", "系统扩展：\(error.localizedDescription)", "システム拡張機能：\(error.localizedDescription)", "Extensión del sistema: \(error.localizedDescription)", "Extension système : \(error.localizedDescription)") }
    }
    func request(_ request: OSSystemExtensionRequest, foundProperties properties: [OSSystemExtensionProperties]) {
        guard requests.removeValue(forKey: ObjectIdentifier(request)) == "status" else { return }
        // A status request submitted before activation must not replace update/approval feedback.
        guard !requests.values.contains(where: { $0 != "status" }), !needsReboot,
              !startAfterActivation else { return }
        // Early CMIO enumeration can bind the old extension and obstruct its replacement.
        updateInstallation(enabled: properties.contains { $0.isEnabled && !$0.isUninstalling }, deviceAvailable: activationCompleted ? findDevice() != nil : nil)
        if !installed && properties.contains(where: { $0.isAwaitingUserApproval }) { showApprovalPrompt() }
        else if !installed && properties.contains(where: { $0.isUninstalling }) { message = tr("Camera is being uninstalled. A restart may be needed", "摄像头正在卸载，可能需要重启", "カメラをアンインストールしています。再起動が必要になる場合があります", "Desinstalando la cámara. Puede que haya que reiniciar", "Désinstallation de la caméra. Un redémarrage peut être nécessaire") }
    }
}

@_cdecl("vtubeleaf_camera_command")
public func cameraCommand(_ operation: Int32, _ output: UnsafeMutablePointer<CChar>?, _ capacity: Int) -> Int32 {
    hostQueue.sync {
        var code: Int32 = 0
        do {
            switch operation {
            case 0: break
            case 1: cameraHost.request("install")
            case 2: cameraHost.request("uninstall")
            case 3: try cameraHost.start()
            case 4: cameraHost.stop()
            default: throw cameraError(tr("Unknown camera operation", "未知摄像头操作", "不明なカメラ操作です", "Operación de cámara desconocida", "Opération de caméra inconnue"))
            }
        } catch { cameraHost.message = error.localizedDescription; code = -1 }
        if let output, capacity > 0, let data = try? JSONSerialization.data(withJSONObject: cameraHost.snapshot()) {
            guard data.count < capacity else { output[0] = 0; return -1 }
            data.copyBytes(to: UnsafeMutableRawPointer(output).assumingMemoryBound(to: UInt8.self), count: data.count)
            output[data.count] = 0
        }
        return code
    }
}

@_cdecl("vtubeleaf_camera_submit")
public func cameraSubmit(_ bytes: UnsafeRawPointer?, _ count: Int) -> Int32 {
    guard let bytes, count == cameraBytes else { return -1 }
    return hostQueue.sync {
        do { try cameraHost.submit(bytes, count: count); return 0 }
        catch { cameraHost.message = error.localizedDescription; return -1 }
    }
}
