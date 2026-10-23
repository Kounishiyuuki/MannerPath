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

/// Implementations must bind attachment bytes and report ownership to App Attest. The production
/// implementation is `AttestedEvidencePhotoUploader`; it is not wired in until photo consent is approved.
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
    /// Photos of a received report that the server already held before the app restarted (`resume`).
    private(set) var previouslyUploaded = 0
    /// Re-attaching to a report received in an earlier launch: new photos may still be chosen for it.
    private(set) var resumed = false
    /// Called after every upload pass so the caller can record progress. Never passed photo bytes.
    var onProgress: (@MainActor () -> Void)?
    var enabled: Bool { policy.enabled && policy.acceptedTermsVersion != nil && uploader != nil }
    var busy: Bool { photos.contains { $0.state == .uploading } }
    var remainingSlots: Int { max(0, policy.maxAttachments - photos.count - previouslyUploaded) }
    /// Every selected photo is held by the server. False for an empty selection: nothing was sent.
    var allUploaded: Bool { !photos.isEmpty && photos.allSatisfy { $0.state == .uploaded } }
    var uploadedCount: Int { photos.filter { $0.state == .uploaded }.count }
    var totalUploaded: Int { previouslyUploaded + uploadedCount }
    /// New photos can still be chosen: before submission, or when re-attaching after a restart.
    var acceptsNewPhotos: Bool { acceptedReportID == nil || resumed }
    /// Photos can be attached to a report recorded under `termsVersion`; `attach` refuses any other consent.
    func accepts(termsVersion: String?) -> Bool { enabled && termsVersion != nil && termsVersion == policy.acceptedTermsVersion }

    init(policy: PhotoEvidencePolicy = PhotoEvidencePolicy(), uploader: (any EvidencePhotoUploading)? = nil) {
        self.policy = policy
        self.uploader = uploader
    }

    /// Raw picker data exists only during this call. Nothing is written to the report draft,
    /// filesystem, logs or API; server sanitization is still mandatory.
    func add(_ raw: Data) {
        guard enabled, !busy, acceptsNewPhotos, remainingSlots > 0 else { return }
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
    func clear() {
        guard !busy else { return }
        photos = []; failures = [:]; acceptedReportID = nil; consentVersion = nil; error = nil
        previouslyUploaded = 0; resumed = false
    }

    func attach(to reportID: String, acceptedTermsVersion: String?) async {
        guard enabled, acceptedTermsVersion == policy.acceptedTermsVersion, !busy else { return }
        acceptedReportID = reportID
        consentVersion = acceptedTermsVersion
        await retry()
    }

    /// After a restart the photos are gone from memory: the user chooses them again for the same report, under the
    /// same consent version and App Attest key. The new photos get new idempotency keys, so a photo whose earlier
    /// upload succeeded without an answer can be stored twice; the server's attachment limit still bounds the count.
    func resume(reportID: String, acceptedTermsVersion: String, alreadyUploaded: Int) {
        guard enabled, acceptedTermsVersion == policy.acceptedTermsVersion, !busy else { return }
        photos = []
        failures = [:]
        error = nil
        acceptedReportID = reportID
        consentVersion = acceptedTermsVersion
        previouslyUploaded = min(max(0, alreadyUploaded), policy.maxAttachments)
        resumed = true
    }

    /// The server will refuse every further photo for this report, so there is nothing left to resume.
    var closedForPhotos: Bool {
        failures.values.contains { failure in
            switch failure {
            case .expired, .reportNotFound, .unauthorized, .authorizationFailed(retryable: false), .attachmentLimit,
                 .termsOutdated: true
            default: false
            }
        }
    }

    /// Retries only what can still succeed. Each attempt reuses the photo's UUID as idempotency key, so a
    /// photo the server already holds is answered with the same photo, never stored twice.
    func retry() async {
        guard enabled, !busy, let reportID = acceptedReportID, let consentVersion, let uploader else { return }
        defer { onProgress?() }
        for index in photos.indices where photos[index].state != .uploaded {
            if let failure = failures[photos[index].id], !failure.isRetryable { continue }
            photos[index].state = .uploading
            do {
                try await uploader.upload(reportID: reportID, attachmentID: photos[index].id,
                                          jpeg: photos[index].jpeg, acceptedTermsVersion: consentVersion)
                photos[index].state = .uploaded
                failures[photos[index].id] = nil
            } catch {
                photos[index].state = .failed
                let failure = error as? EvidencePhotoUploadError ?? .temporarilyUnavailable
                failures[photos[index].id] = failure
                // Report-level refusals would refuse every remaining photo identically: stop sending.
                if Self.endsReport(failure) {
                    for rest in photos.indices where photos[rest].state == .selected {
                        photos[rest].state = .failed
                        failures[photos[rest].id] = failure
                    }
                    return
                }
            }
        }
    }

    /// The user-facing reason for a failed photo, phrased for what the user can still do.
    func failureMessage(for id: UUID) -> String? {
        guard photos.first(where: { $0.id == id })?.state == .failed else { return nil }
        switch failures[id] ?? .temporarilyUnavailable {
        case .temporarilyUnavailable: return String(localized: "The photo could not be sent because of a connection problem. You can retry it.")
        case .rateLimited: return String(localized: "Too many photos were sent. Wait a moment, then retry.")
        case .authorizationFailed(retryable: true): return String(localized: "The security check for this photo did not pass. You can retry it.")
        case .authorizationFailed(retryable: false), .unauthorized:
            return String(localized: "This device can no longer add photos to this report. The report itself was received.")
        case .updateRequired: return String(localized: "Update the app to send photos.")
        case .disabled: return String(localized: "Photo intake is paused. The report itself was received.")
        case .expired, .reportNotFound: return String(localized: "The time for adding photos to this report has ended.")
        case .tooLarge: return String(localized: "This photo is too large to send.")
        case .invalidImage: return String(localized: "This photo could not be accepted. Choose a different photo for your next report.")
        case .attachmentLimit: return String(localized: "This report already has the maximum number of photos.")
        case .idempotencyConflict: return String(localized: "This photo conflicts with an earlier upload and cannot be sent again.")
        case .termsOutdated: return String(localized: "The report terms have changed. Update the app to send photos.")
        }
    }

    /// Why each failed photo failed (an unknown uploader error reads as retryable). Memory only.
    private(set) var failures: [UUID: EvidencePhotoUploadError] = [:]
    #if DEBUG
    /// Set only by the UI-test composition: the simulator photo library is not scriptable.
    static var uiTestSample: Data?
    #endif
    /// For P3: whether a retry action can still change anything.
    var canRetry: Bool { photos.contains { $0.state == .failed && failures[$0.id]?.isRetryable != false } }

    private static func endsReport(_ failure: EvidencePhotoUploadError) -> Bool {
        switch failure {
        case .disabled, .expired, .reportNotFound, .unauthorized, .updateRequired, .termsOutdated, .attachmentLimit,
             .authorizationFailed(retryable: false): true
        default: false
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
    /// A new-place proposal needs at least one photo; other reports keep photos optional.
    var required = false
    @State private var selection: [PhotosPickerItem] = []
    var body: some View {
        Section {
            Text("Avoid faces, vehicle plates and unrelated surroundings. A photo of an ashtray does not establish permission to smoke. Photos stay on this screen until submission; closing the app discards them.")
                .font(.footnote)
            Text("The photo's location data is not used. The listed position is only the map pin you chose.")
                .font(.footnote).foregroundStyle(.secondary)
            if photos.acceptsNewPhotos && photos.remainingSlots > 0 {
                // Read outside the picker's Sendable label closure.
                let title = photos.photos.isEmpty ? String(localized: "Choose photos (up to 3)") : String(localized: "Add another photo")
                PhotosPicker(selection: $selection, maxSelectionCount: photos.remainingSlots,
                             selectionBehavior: .ordered, matching: .images) {
                    Label(title, systemImage: "photo.on.rectangle")
                }
                .disabled(photos.busy)
                .accessibilityIdentifier("report.photo.choose")
                #if DEBUG
                if let sample = ReportPhotos.uiTestSample {
                    Button("Add test photo") { photos.add(sample) }.accessibilityIdentifier("report.photo.addTest")
                }
                #endif
            }
            ForEach(Array(photos.photos.enumerated()), id: \.element.id) { index, photo in
                VStack(alignment: .leading, spacing: 6) {
                    if let image = UIImage(data: photo.jpeg) {
                        Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 180)
                            .accessibilityLabel("Selected photo \(index + 1) preview")
                    }
                    switch photo.state {
                    case .selected: EmptyView()
                    case .uploading: ProgressView("Uploading photo…")
                    case .uploaded: Label("Photo received for review", systemImage: "checkmark.circle")
                    case .failed:
                        Label(photos.failureMessage(for: photo.id) ?? "", systemImage: "exclamationmark.triangle")
                            .accessibilityIdentifier("report.photo.failure")
                    }
                    if photo.state != .uploaded && photos.acceptsNewPhotos {
                        Button("Remove this photo", role: .destructive) { photos.remove(photo.id) }
                            .disabled(photos.busy).accessibilityIdentifier("report.photo.remove")
                    }
                }
            }
            if photos.resumed && photos.photos.contains(where: { $0.state == .selected }) {
                Button("Send chosen photos") { Task { await photos.retry() } }.disabled(photos.busy)
                    .accessibilityIdentifier("report.photo.sendResumed")
            }
            if photos.canRetry {
                Button("Retry unsent photos") { Task { await photos.retry() } }.disabled(photos.busy)
                    .accessibilityIdentifier("report.photo.retry")
            }
            if let error = photos.error { Text(error).accessibilityLabel(error) }
        } header: {
            if photos.acceptedReportID != nil { Text("Photos for the received report") }
            else { Text(required ? "Photos (required, 1 to 3)" : "Evidence photos (optional)") }
        } footer: {
            if required && photos.photos.isEmpty { Text("Add at least one photo of the smoking place to submit.") }
        }
        .onChange(of: selection) { _, items in
            guard !items.isEmpty else { return }
            Task {
                for item in items {
                    do {
                        if let data = try await item.loadTransferable(type: Data.self) { photos.add(data) }
                        else { photos.selectionFailed() }
                    } catch { photos.selectionFailed() }
                }
                selection = []
            }
        }
    }
}
