import Foundation
import PDFKit
import AppKit

let a = CommandLine.arguments
guard a.count >= 3 else { print("usage: pdfraster <in.pdf> <outdir> [scale]"); exit(1) }
let url = URL(fileURLWithPath: a[1])
let outDir = URL(fileURLWithPath: a[2], isDirectory: true)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let scale: CGFloat = a.count > 3 ? (CGFloat(Double(a[3]) ?? 2.0)) : 2.0
guard let doc = PDFDocument(url: url) else { print("cannot open"); exit(1) }
for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let rect = page.bounds(for: .mediaBox)
    let w = Int(rect.width * scale), h = Int(rect.height * scale)
    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { continue }
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    page.draw(with: .mediaBox, to: ctx)
    guard let img = ctx.makeImage() else { continue }
    let rep = NSBitmapImageRep(cgImage: img)
    if let data = rep.representation(using: .png, properties: [:]) {
        let name = String(format: "p%03d.png", i + 1)
        try? data.write(to: outDir.appendingPathComponent(name))
    }
}
print("pages=\(doc.pageCount)")
