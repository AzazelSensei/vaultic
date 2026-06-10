import LocalAuthentication
import Foundation

// Exit codes (broker TouchIdApprover treats 0=approved, everything else=denied):
// 0 = approved, 1 = denied/error, 2 = biometry unavailable, 3 = user cancel

let reason = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "vaultic approval"
let context = LAContext()
context.touchIDAuthenticationAllowableReuseDuration = 0

var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
    FileHandle.standardError.write("biometry unavailable: \(error?.localizedDescription ?? "unknown")\n".data(using: .utf8)!)
    exit(2)
}

let semaphore = DispatchSemaphore(value: 0)
var exitCode: Int32 = 1
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, evalError in
    if success {
        exitCode = 0
    } else if let laError = evalError as? LAError, laError.code == .userCancel {
        exitCode = 3
    }
    semaphore.signal()
}
semaphore.wait()
exit(exitCode)
