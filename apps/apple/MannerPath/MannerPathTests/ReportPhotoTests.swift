import Foundation
import ImageIO
import Testing
import UIKit
import UniformTypeIdentifiers
@testable import MannerPath

private actor PhotoTestUploader: EvidencePhotoUploading {
    var ids: [UUID] = []
    func upload(reportID: String, attachmentID: UUID, jpeg: Data, acceptedTermsVersion: String) async throws {
        ids.append(attachmentID)
        if ids.count == 1 { throw CocoaError(.fileWriteUnknown) }
    }
    func attemptedIDs() -> [UUID] { ids }
}

private struct PhotoTestReports: ReportConfigFetching, ReportSubmitting, InstallIDProviding {
    func fetchAvailability() async throws -> ReportAvailability { .unknown }
    func submit(_ body: Data) async throws -> AcceptedReport { throw CocoaError(.fileReadUnknown) }
    func installID() -> UUID { UUID() }
}

struct ReportPhotoTests {
    @MainActor private func image() -> Data {
        UIGraphicsImageRenderer(size: CGSize(width: 8, height: 4)).image { context in
            UIColor.white.setFill()
            context.fill(CGRect(x: 0, y: 0, width: 8, height: 4))
        }.pngData()!
    }

    @Test @MainActor func photoSelectionNeverChangesSavedReportDraftAndRestartPreservesText() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = FileReportDraftStore(directory: directory)
        let service = PhotoTestReports()
        let model = ReportModel(configClient: service, reportClient: service, store: store, installIDs: service,
                                photoPolicy: PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: "test-only"),
                                photoUploader: PhotoTestUploader())
        model.start(type: .exists, spotId: "sp_test")
        var draft = try #require(model.draft)
        draft.note = "Signage observed"
        model.saveDraft(draft)
        model.photos.add(image())
        #expect(try store.load() == draft)
        model.photos.selectionFailed()
        #expect(try store.load() == draft)
        let restarted = ReportModel(configClient: service, reportClient: service, store: store, installIDs: service)
        #expect(restarted.draft == draft)
        #expect(restarted.photos.photos.isEmpty)
        #expect(!restarted.photos.enabled)
    }

    @Test @MainActor func disabledAndMissingConsentNeverSelect() {
        let disabled = ReportPhotos()
        disabled.add(image())
        #expect(!disabled.enabled)
        #expect(disabled.photos.isEmpty)
        let missing = ReportPhotos(policy: PhotoEvidencePolicy(enabled: true), uploader: PhotoTestUploader())
        missing.add(image())
        #expect(!missing.enabled)
        #expect(missing.photos.isEmpty)
    }

    @Test @MainActor func selectRemoveAndMalformedSelectionPreserveExistingPreview() throws {
        let model = ReportPhotos(policy: PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: "test-only"),
                                 uploader: PhotoTestUploader())
        let original = try #require(CGImageSourceCreateWithData(image() as CFData, nil))
        let bitmap = try #require(CGImageSourceCreateImageAtIndex(original, 0, nil))
        let raw = NSMutableData()
        let destination = try #require(CGImageDestinationCreateWithData(raw, UTType.jpeg.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(destination, bitmap, [
            kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 35.0, kCGImagePropertyGPSLatitudeRef: "N"],
            kCGImagePropertyExifDictionary: [kCGImagePropertyExifDateTimeOriginal: "2026:10:02 12:00:00"],
            kCGImagePropertyTIFFDictionary: [kCGImagePropertyTIFFMake: "Private device"]
        ] as CFDictionary)
        #expect(CGImageDestinationFinalize(destination))
        model.add(raw as Data)
        let selected = try #require(model.photos.first)
        let source = try #require(CGImageSourceCreateWithData(selected.jpeg as CFData, nil))
        let properties = try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
        #expect(properties[kCGImagePropertyGPSDictionary] == nil)
        #expect(properties[kCGImagePropertyExifDictionary] == nil)
        #expect((properties[kCGImagePropertyTIFFDictionary] as? [CFString: Any])?[kCGImagePropertyTIFFMake] == nil)
        model.add(Data("malformed".utf8))
        #expect(model.photos.count == 1)
        #expect(model.error != nil)
        model.remove(selected.id)
        #expect(model.photos.isEmpty)
    }

    @Test @MainActor func failedUploadRetriesSameAttachmentAndConsentFailsClosed() async throws {
        let uploader = PhotoTestUploader()
        let model = ReportPhotos(policy: PhotoEvidencePolicy(enabled: true, acceptedTermsVersion: "test-only"), uploader: uploader)
        model.add(image())
        let selected = try #require(model.photos.first)
        await model.attach(to: "rp_test", acceptedTermsVersion: "other")
        #expect(await uploader.attemptedIDs().isEmpty)
        await model.attach(to: "rp_test", acceptedTermsVersion: "test-only")
        #expect(model.photos.first?.state == .failed)
        #expect(model.photos.first?.jpeg == selected.jpeg)
        await model.retry()
        #expect(model.photos.first?.state == .uploaded)
        #expect(await uploader.attemptedIDs() == [selected.id, selected.id])
        await model.retry()
        #expect(await uploader.attemptedIDs().count == 2)
    }
}
