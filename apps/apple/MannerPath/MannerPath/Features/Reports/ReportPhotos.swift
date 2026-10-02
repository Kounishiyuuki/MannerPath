import Foundation
import ImageIO
import Observation
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Injected only for a future rights-approved deployment. No shipped terms cover photos yet.
nonisolated struct PhotoEvidencePolicy: Sendable {
    var enabled = false
    var acceptedTermsVersion: String? = nil
    var maxAttachments = 3
}

/// Implementations must bind attachment bytes and report ownership to App Attest. There is no
/// production implementation until the photo consent and transport contracts are approved.
nonisolated protocol EvidencePhotoUploading: Sendable {
    func upload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) async throws
}

nonisolated enum PhotoUploadState: Equatable, Sendable {
    case selected, uploading, uploaded, failed
}
nonisolated struct ReportPhoto: Identifiable, Sendable {
    let id: UUID
    let jpeg: Data
    var state: PhotoUploadState = .selected
}

@MainActor @Observable
final class ReportPhotos {
    private let policy: PhotoEvidencePolicy
    private let uploader: (any EvidencePhotoUploading)?
    private(set) var photos: [ReportPhoto] = []
    private(set) var error: String?
    private(set) var acceptedReportID: String?
    private var consentVersion: String?
    var enabled: Bool { policy.enabled && policy.acceptedTermsVersion != nil && uploader != nil }
    var busy: Bool { photos.contains { $0.state == .uploading } }

    init(policy: PhotoEvidencePolicy = PhotoEvidencePolicy(), uploader: (any EvidencePhotoUploading)? = nil) {
        self.policy = policy
        self.uploader = uploader
    }

    /// Raw picker data exists only during this call. Nothing is written to the report draft,
    /// filesystem, logs or API; server sanitization is still mandatory.
    func add(_ raw: Data) {
        guard enabled, !busy, acceptedReportID == nil, photos.count < policy.maxAttachments else { return }
        do {
            let jpeg = try Self.normalize(raw)
            photos.append(ReportPhoto(id: UUID(), jpeg: jpeg))
            error = nil
        } catch { self.error = String(localized: "This photo could not be prepared. Choose a JPEG or PNG within the size limit.") }
    }

    func selectionFailed() { error = String(localized: "The selected photo could not be loaded. Try choosing it again.") }
    func remove(_ id: UUID) {
        guard !busy else { return }
        photos.removeAll { $0.id == id && $0.state != .uploaded }
    }
    func clear() { guard !busy else { return }; photos = []; acceptedReportID = nil; consentVersion = nil; error = nil }

    func attach(to reportID: String, acceptedTermsVersion: String?) async {
        guard enabled, acceptedTermsVersion == policy.acceptedTermsVersion, !busy else { return }
        acceptedReportID = reportID
        consentVersion = acceptedTermsVersion
        await retry()
    }

    func retry() async {
        guard enabled, !busy, let reportID = acceptedReportID, let consentVersion, let uploader else { return }
        for index in photos.indices where photos[index].state != .uploaded {
            photos[index].state = .uploading
            do {
                try await uploader.upload(reportID: reportID, attachmentID: photos[index].id,
                                          jpeg: photos[index].jpeg, acceptedTermsVersion: consentVersion)
                photos[index].state = .uploaded
            } catch { photos[index].state = .failed }
        }
    }

    private static func normalize(_ raw: Data) throws -> Data {
        guard raw.count <= 8 * 1024 * 1024,
              let source = CGImageSourceCreateWithData(raw as CFData, nil),
              CGImageSourceGetCount(source) == 1,
              let type = CGImageSourceGetType(source) as String?,
              [UTType.jpeg.identifier, UTType.png.identifier].contains(type),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = properties[kCGImagePropertyPixelWidth] as? Int,
              let height = properties[kCGImagePropertyPixelHeight] as? Int,
              width > 0, height > 0, width <= 4096, height <= 4096,
              width * height <= 16_000_000,
              let image = UIImage(data: raw) else { throw CocoaError(.fileReadCorruptFile) }
        let originalSize = image.size
        let scale = min(1, sqrt(2_000_000 / (originalSize.width * originalSize.height)),
                        2048 / max(originalSize.width, originalSize.height))
        let size = CGSize(width: floor(originalSize.width * scale), height: floor(originalSize.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            UIColor.white.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
        let output = NSMutableData()
        guard let bitmap = rendered.cgImage,
              let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        CGImageDestinationAddImage(destination, bitmap,
                                  [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw CocoaError(.fileReadCorruptFile) }
        // ImageIO synthesizes an EXIF pixel-dimension dictionary even for a fresh bitmap.
        // Remove metadata segments from this encoder-produced JPEG, preserving image tables.
        let bytes = [UInt8](output as Data)
        var stripped = Data(bytes.prefix(2))
        var offset = 2
        while offset + 3 < bytes.count {
            guard bytes[offset] == 0xff else { throw CocoaError(.fileReadCorruptFile) }
            let marker = bytes[offset + 1]
            if marker == 0xda {
                stripped.append(contentsOf: bytes[offset...])
                guard stripped.count <= 5 * 1024 * 1024 else { throw CocoaError(.fileReadCorruptFile) }
                return stripped
            }
            let length = Int(bytes[offset + 2]) * 256 + Int(bytes[offset + 3])
            guard length >= 2, offset + length + 2 <= bytes.count else { throw CocoaError(.fileReadCorruptFile) }
            if !(0xe1...0xef).contains(marker) && marker != 0xfe {
                stripped.append(contentsOf: bytes[offset..<(offset + length + 2)])
            }
            offset += length + 2
        }
        throw CocoaError(.fileReadCorruptFile)
    }
}

struct ReportPhotoSection: View {
    @Bindable var photos: ReportPhotos
    @State private var selection: PhotosPickerItem?
    var body: some View {
        Section("Evidence photos (optional)") {
            Text("Avoid people, vehicle plates and unrelated surroundings. A photo of an ashtray does not establish permission to smoke. Photos stay on this screen until submission; closing the app discards them.")
                .font(.footnote)
            if photos.acceptedReportID == nil {
                PhotosPicker(selection: $selection, matching: .images) { Label("Choose evidence photo", systemImage: "photo") }
                    .disabled(photos.busy)
                    .accessibilityIdentifier("report.photo.choose")
            }
            ForEach(photos.photos) { photo in
                if let image = UIImage(data: photo.jpeg) {
                    Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180)
                        .accessibilityLabel("Selected evidence photo preview")
                }
                if photo.state == .uploading { ProgressView("Uploading evidence photo") }
                if photo.state == .uploaded { Label("Photo received for review", systemImage: "checkmark") }
                if photo.state == .failed { Text("Photo upload failed. Your selected photo remains available for retry.") }
                if photo.state != .uploaded {
                    Button("Remove evidence photo", role: .destructive) { photos.remove(photo.id) }
                        .disabled(photos.busy).accessibilityIdentifier("report.photo.remove")
                }
            }
            if photos.photos.contains(where: { $0.state == .failed }) {
                Button("Retry photo upload") { Task { await photos.retry() } }.disabled(photos.busy)
                    .accessibilityIdentifier("report.photo.retry")
            }
            if let error = photos.error { Text(error).accessibilityLabel(error) }
        }
        .onChange(of: selection) { _, item in
            Task {
                do {
                    if let data = try await item?.loadTransferable(type: Data.self) { photos.add(data) }
                    else { photos.selectionFailed() }
                } catch { photos.selectionFailed() }
                selection = nil
            }
        }
    }
}
