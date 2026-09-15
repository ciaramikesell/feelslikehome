import UIKit
import Capacitor
import os

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    private let logger = Logger(subsystem: "app.feelslikehome.mobile", category: "NativeLifecycle")
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        logger.info("Native scene connecting")
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = CAPBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Never log the URL: it may contain an invite token or listing URL.
        logger.info("URL context received; forwarding to Capacitor")
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        logger.info("Universal Link activity received; forwarding to Capacitor")
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
