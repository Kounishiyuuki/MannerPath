import Foundation
import Testing
@testable import MannerPath

// ADR-0013 community acquisition on iPhone: structured findings, one-tap "it was here", corrections, duplicate
// suggestions and nearby confirmation tasks — derived on the device, sent only where the deployment accepts them.
private final class VectorBundleAnchor {}

private struct FixedConfig: ReportConfigFetching {
    let value: ReportAvailability
    func fetchAvailability() async throws -> ReportAvailability { value }
}

private actor RecordingSubmitter: ReportSubmitting {
    var bodies: [Data] = []
    func submit(_ body: Data) async throws -> AcceptedReport {
        bodies.append(body)
        return AcceptedReport(schemaVersion: 1, reportId: "rp_" + String(repeating: "0", count: 26), state: "pending",
                              receivedAt: "2026-10-01T00:00:00Z")
    }
    func last() -> Data? { bodies.last }
}

private struct FixedInstall: InstallIDProviding {
    func installID() -> UUID { UUID(uuidString: "8f1c4d2e-0a3b-4c5d-8e9f-0a1b2c3d4e5f")! }
}

private final class MemoryConsent: ReportConsentRemembering, @unchecked Sendable {
    private let lock = NSLock()
    private var value: String?
    init(_ value: String? = nil) { self.value = value }
    func agreedVersion() -> String? { lock.withLock { value } }
    func remember(_ version: String?) { lock.withLock { value = version } }
}

@MainActor
struct CommunityAcquisitionTests {
    private let spotID = "sp_01V64NN31G72E5KJJ5W22W1A1J"
    private let terms = ReportTerms.bundledVersion
    private let now = ISO8601DateFormatter().date(from: "2026-10-01T00:00:00Z")!

    private var current: ReportLimits {
        var limits = ReportLimits(noteMaxLength: 280, maxBodyBytes: 4096)
        limits.termsVersion = terms
        limits.acceptsNewSpotClaim = true
        limits.acceptsExistingSpotFindings = true
        return limits
    }

    private func body(_ draft: ReportDraft, _ limits: ReportLimits) throws -> [String: Any] {
        try JSONSerialization.jsonObject(with: ReportRequest.encoded(draft: draft, installId: UUID(), limits: limits)) as! [String: Any]
    }

    private func model(limits: ReportLimits, consent: MemoryConsent, submitter: RecordingSubmitter) async -> ReportModel {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString, directoryHint: .isDirectory)
        let model = ReportModel(configClient: FixedConfig(value: .available(limits)), reportClient: submitter,
                                store: FileReportDraftStore(directory: directory), installIDs: FixedInstall(), consent: consent)
        await model.refreshAvailability()
        return model
    }

    // MARK: - findings and corrections on the wire

    @Test func findingsAreSentAsTheirOwnTypesOnlyWhereTheDeploymentAcceptsThem() throws {
        var draft = ReportDraft(type: .notFound, spotId: spotID, acceptedTermsVersion: terms)
        #expect(try body(draft, current)["type"] as? String == "notFound")
        var old = current
        old.acceptsExistingSpotFindings = false
        #expect(throws: ReportValidationError.unsupportedReportType) { try ReportRequest.encoded(draft: draft, installId: UUID(), limits: old) }
        #expect(!ReportType.corrections(acceptsFindings: false).contains(.removed))
        #expect(ReportType.corrections(acceptsFindings: true).prefix(2) == [.notFound, .removed])
        draft.type = .removed
        #expect(try body(draft, current)["proposedLocation"] == nil, "a negative finding carries no location")
    }

    @Test func correctionsTravelAsTheClaimOfTheirTypeAndAreDroppedForAnOlderDeployment() throws {
        var draft = ReportDraft(type: .typeChanged, spotId: spotID, acceptedTermsVersion: terms)
        draft.correction = ReportCorrection(spotType: "smokingPermittedVenue")
        #expect((try body(draft, current)["claim"] as? [String: Any])?["spotType"] as? String == "smokingPermittedVenue")

        var access = ReportDraft(type: .accessChanged, spotId: spotID, acceptedTermsVersion: terms)
        access.correction = ReportCorrection(accessType: "facilityOnly", accessDetail: "ticketedUsersOnly")
        let claim = try #require(try body(access, current)["claim"] as? [String: Any])
        #expect(claim["accessDetail"] as? String == "ticketedUsersOnly")
        #expect(claim["spotType"] == nil)
        var old = current
        old.acceptsExistingSpotFindings = false
        #expect(try body(access, old)["claim"] == nil, "an older deployment's strict schema would reject it")

        access.correction = ReportCorrection(accessType: "public", accessDetail: "ticketedUsersOnly")
        #expect(throws: ReportValidationError.invalidCorrection) { try ReportRequest.encoded(draft: access, installId: UUID(), limits: current) }
        var wrong = ReportDraft(type: .notFound, spotId: spotID, acceptedTermsVersion: terms)
        wrong.correction = ReportCorrection(spotType: "ashtray")
        #expect(throws: ReportValidationError.invalidCorrection) { try ReportRequest.encoded(draft: wrong, installId: UUID(), limits: current) }
    }

    @Test func draftsSavedByAnEarlierBuildStillDecode() throws {
        let json = #"{"type":"moved","spotId":"sp_01V64NN31G72E5KJJ5W22W1A1J","proposedLocation":{"latitude":35.7,"longitude":139.7}}"#
        let draft = try JSONDecoder().decode(ReportDraft.self, from: Data(json.utf8))
        #expect(draft.correction == nil && draft.claim == nil && draft.acceptedTermsVersion == nil)
    }

    // MARK: - one-tap confirmation

    @Test func stillHereIsTwoTapsOnceTheseTermsWereAgreedAndNeverAssumedForAnotherVersion() async throws {
        let submitter = RecordingSubmitter()
        let first = await model(limits: current, consent: MemoryConsent(), submitter: submitter)
        first.startQuickConfirm(spotId: spotID, subjectName: "上野駅前")
        #expect(first.draft?.type == .exists)
        #expect(first.draft?.acceptedTermsVersion == nil, "the first time, the user agrees explicitly")
        first.setTermsAccepted(true)
        await first.submit()
        let sentBody = try #require(await submitter.last())
        let sent = try #require(try JSONSerialization.jsonObject(with: sentBody) as? [String: Any])
        #expect(sent["type"] as? String == "exists")
        #expect(sent["spotId"] as? String == spotID)
        #expect(sent["note"] == nil && sent["observedOn"] == nil && sent["proposedLocation"] == nil, "no free text, date or location")
        #expect(sent["acceptedTermsVersion"] as? String == terms)

        let remembered = MemoryConsent(terms)
        let second = await model(limits: current, consent: remembered, submitter: submitter)
        second.startQuickConfirm(spotId: spotID, subjectName: nil)
        #expect(second.draft?.acceptedTermsVersion == terms, "agreed to this exact version before: tap, then send")

        let stale = await model(limits: current, consent: MemoryConsent("report-terms.2026-01-01.draft"), submitter: submitter)
        stale.startQuickConfirm(spotId: spotID, subjectName: nil)
        #expect(stale.draft?.acceptedTermsVersion == nil, "another version is never treated as agreed")
    }

    @Test func aSavedDraftBlocksANewQuickConfirmation() async {
        let m = await model(limits: current, consent: MemoryConsent(terms), submitter: RecordingSubmitter())
        m.start(type: .moved, spotId: spotID)
        m.startQuickConfirm(spotId: "sp_01V64NN31G72E5KJJ5W22W1A1K", subjectName: nil)
        #expect(m.draft?.type == .moved, "one draft at a time; the saved one is never replaced silently")
        #expect(!m.canStartReport)
    }

    // MARK: - add a place / duplicates

    @Test func addingAPlaceNearAListedOneOffersItAndCanTurnIntoAConfirmation() async throws {
        let listed = spot("sp_listed", latitude: 35.7, longitude: 139.7)
        let pin = ReportCoordinate(latitude: 35.70020, longitude: 139.7)
        let near = DuplicateCandidates.near(pin, in: [listed, spot("sp_far", latitude: 35.71, longitude: 139.7)])
        #expect(near.map(\.spot.id) == ["sp_listed"])
        #expect(near[0].distanceMeters < 50)

        let m = await model(limits: current, consent: MemoryConsent(), submitter: RecordingSubmitter())
        m.startNewSpot(pin: pin)
        #expect(m.draft?.type == .missing && m.draft?.proposedLocation == pin.quantized && m.draft?.claim != nil)
        m.setTermsAccepted(true)
        m.confirmExistingInstead(spotId: "sp_listed", subjectName: "listed")
        #expect(m.draft?.type == .exists && m.draft?.spotId == "sp_listed")
        #expect(m.draft?.proposedLocation == nil && m.draft?.claim == nil, "the pin and claim are dropped, nothing is merged")
        #expect(m.draft?.acceptedTermsVersion == terms)
    }

    // MARK: - coverage tasks

    @Test func coverageTaskRulesMatchTheSharedContract() throws {
        let url = try #require(Bundle(for: VectorBundleAnchor.self).url(forResource: "coverage-tasks.v1", withExtension: "json"))
        let vectors = try #require(try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        #expect(vectors["rules"] as? String == CoverageTasks.rulesVersion)
        let at = try #require(ISO8601DateFormatter().date(from: vectors["now"] as! String))
        for c in vectors["cases"] as! [[String: Any]] {
            let s = c["spot"] as! [String: Any]
            let v = s["verification"] as? [String: Any]
            let spot = spot("sp_vector", latitude: 35, longitude: 139,
                            spotType: SpotType(rawValue: s["spotType"] as! String)!, accessType: AccessType(rawValue: s["accessType"] as! String)!,
                            verified: (s["lastVerifiedAt"] as? String).flatMap(day),
                            existence: (v?["existence"] as? String).map(ExistenceEvidence.init(wire:)),
                            precision: (v?["locationPrecision"] as? String).map(LocationPrecision.init(wire:)),
                            confirmations: v?["confirmations"] as? Int, month: v?["lastReviewedMonth"] as? String)
            #expect(CoverageTasks.kinds(for: spot, at: at).map(\.rawValue) == c["expected"] as! [String], "\(c["name"]!)")
        }
    }

    @Test func nearbyConfirmationTasksAreTheClosestUnconfirmedPlacesOnly() {
        let reported = spot("sp_reported", latitude: 35, longitude: 139, existence: .communityReported, precision: .communityPinned, confirmations: 1, month: "2026-09")
        let official = spot("sp_official", latitude: 35, longitude: 139, verified: day("2026-08-01"), existence: .official, precision: .publisherPoint)
        let results = [NearbyResult(spot: reported, distanceMeters: 300, bearingDegrees: 0, verificationAge: nil),
                       NearbyResult(spot: official, distanceMeters: 100, bearingDegrees: 0, verificationAge: nil)]
        #expect(CoverageTasks.nearbyConfirmations(results, at: now).map(\.spot.id) == ["sp_reported"])
        #expect(SpotPresentation.confirmationSummary(reported) == String(localized: "Reported by one user · no one else has confirmed it yet"))
        let verified = spot("sp_verified", latitude: 35, longitude: 139, existence: .communityVerified, precision: .communityPinned, confirmations: 4, month: "2026-09")
        #expect(SpotPresentation.confirmationSummary(verified) == String(localized: "Confirmed by \(4) users"))
        #expect(SpotPresentation.confirmationSummary(official) == String(localized: "Officially confirmed"))
    }

    // MARK: - fixtures

    private func day(_ value: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: value)
    }

    private func spot(_ id: String, latitude: Double, longitude: Double, spotType: SpotType = .ashtray, accessType: AccessType = .public,
                      verified: Date? = nil, existence: ExistenceEvidence? = nil, precision: LocationPrecision? = nil,
                      confirmations: Int? = nil, month: String? = nil) -> Spot {
        Spot(id: id, mergedInto: nil, name: id, latitude: latitude, longitude: longitude,
             tileId: "14/14553/6449", spotType: spotType, hostType: nil, accessType: accessType, environment: .unknown,
             supportsPaper: .unknown, supportsHeated: .unknown, openingHours: nil, feeType: nil, floor: nil,
             entranceNote: nil, lifecycle: .active,
             verification: SpotVerification(acceptedExistenceEvidence: .yes, evidenceQuality: nil, sourceDisplayNames: [],
                                            existence: existence, locationPrecision: precision,
                                            confirmations: confirmations, lastReviewedMonth: month),
             lastVerifiedAt: verified, createdAt: nil, updatedAt: nil)
    }
}
