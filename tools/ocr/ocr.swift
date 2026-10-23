import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count > 1 else { print("usage: ocr <image...>"); exit(1) }
let langs = ["zh-Hans", "en-US"]
for path in args.dropFirst() {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        FileHandle.standardError.write("skip \(path)\n".data(using: .utf8)!); continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = langs
    req.usesLanguageCorrection = false
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try handler.perform([req]) } catch { continue }
    let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    print("# \(path)")
    print(lines.joined(separator: "\n"))
}
