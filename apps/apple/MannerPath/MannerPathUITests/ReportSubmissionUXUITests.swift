import XCTest

// Exercises the shipped SwiftUI flow with the existing DEBUG-only, local report stack. A receipt in these tests
// proves client state transitions only, never App Attest, signed-device readiness or production delivery.
final class J_ReportSubmissionUXUITests: MannerPathUITestCase {
    private var submit: XCUIElement { app.buttons["report.submit"] }
    private var pinButton: XCUIElement { app.buttons["report.pin.choose"] }

    private func settle(_ element: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(10)
        var previous = CGRect.null
        while Date() < deadline {
            let frame = element.exists ? element.frame : .null
            if frame == previous, element.isEnabled, element.isHittable { return }
            previous = frame
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTFail("Control did not settle: \(element)", file: file, line: line)
    }

    private func openEntry() {
        let entry = app.buttons["mapReportButton"]
        XCTAssertTrue(entry.waitForExistence(timeout: 90))
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 30))
        settle(entry)
        XCTAssertGreaterThanOrEqual(entry.frame.height, 44)
        XCTAssertTrue(entry.label.contains("喫煙所を追加する") || entry.label.contains("保存済みの報告を再開"))
        entry.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
    }

    private func choosePin() {
        scrollTo(app.descendants(matching: .any)["report.newPlace.introduction"], upwards: true)
        scrollTo(pinButton)
        settle(pinButton)
        pinButton.tap()
        let center = app.buttons["report.pin.useCenter"]
        XCTAssertTrue(center.waitForExistence(timeout: 10))
        settle(center)
        center.tap()
        let confirm = app.buttons["report.pin.confirm"]
        scrollTo(confirm)
        settle(confirm)
        if app.launchArguments.contains("UICTContentSizeCategoryAccessibilityXXXL") {
            screenshot("report-ux-19-pin-large-text-fixture")
        }
        confirm.tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForNonExistence(timeout: 10))
    }

    private func addPhotoAndAgree() {
        let photo = app.buttons["report.photo.addTest"]
        scrollTo(photo)
        settle(photo)
        photo.tap()
        let agree = app.switches["報告に関する規約に同意する"]
        scrollTo(agree)
        let control = agree.switches.firstMatch.exists ? agree.switches.firstMatch : agree
        // At accessibility sizes iOS 18 can expose the row before its nested switch is on screen.
        scrollTo(control)
        settle(control)
        control.tap()
        let on = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1'"), object: agree)
        XCTAssertEqual(XCTWaiter().wait(for: [on], timeout: 5), .completed)
    }

    func testNewApplicantSeesRequirementsThenOneReceiptPendingReview() {
        launch(extraArguments: ["-uiTestPhotoReport", "success"])
        openEntry()
        XCTAssertTrue(app.descendants(matching: .any)["report.newPlace.introduction"].exists)
        screenshot("report-ux-01-introduction-fixture")
        scrollTo(submit)
        XCTAssertFalse(submit.exists && submit.isEnabled, "A missing pin is explained before a submission can be attempted")
        XCTAssertTrue(app.descendants(matching: .any)["report.readiness"].exists)
        screenshot("report-ux-02-input-needed-fixture")
        choosePin()
        addPhotoAndAgree()
        scrollTo(submit)
        settle(submit)
        XCTAssertTrue(submit.isEnabled, "Unknown optional details do not block a new-place proposal")
        screenshot("report-ux-03-review-fixture")
        submit.tap()
        XCTAssertTrue(app.buttons["下書きを破棄"].waitForNonExistence(timeout: 15))
        let pending = app.descendants(matching: .any)["report.pendingReview"]
        scrollTo(pending)
        XCTAssertFalse(pending.label.isEmpty)
        XCTAssertFalse(submit.exists, "The accepted report must not be offered for submission again")
        let photoReceipt = app.descendants(matching: .any)["report.photo.receivedSummary"]
        scrollTo(photoReceipt)
        XCTAssertFalse(app.descendants(matching: .any)["report.photo.preparationNotice"].exists,
                       "Already received photos use the receipt explanation, not preparation instructions")
        screenshot("report-ux-04-pending-review-fixture")
    }

    func testCloseAndCancelledDiscardKeepSelectedPinAndPhotos() {
        launch(extraArguments: ["-uiTestPhotoReport", "success"])
        openEntry()
        choosePin()
        addPhotoAndAgree()
        app.buttons["閉じる"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForNonExistence(timeout: 10))
        openEntry()
        // Reopening the picker restores the user's candidate; there is no new automatic current-location choice.
        scrollTo(pinButton, upwards: true)
        pinButton.tap()
        let confirm = app.buttons["report.pin.confirm"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 10))
        scrollTo(confirm)
        settle(confirm)
        confirm.tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForNonExistence(timeout: 10))
        app.buttons["下書きを破棄"].tap()
        let keep = app.buttons["report.discard.cancel"].firstMatch
        XCTAssertTrue(keep.waitForExistence(timeout: 10))
        keep.tap()
        scrollTo(submit)
        XCTAssertTrue(submit.isEnabled, "Closing or cancelling discard keeps pin, in-memory photo and exact consent")
        screenshot("report-ux-05-draft-kept-fixture")
    }

    func testLargestTextKeepsNamedControlsAndKeyboardDraft() {
        launch(extraArguments: ["-uiTestPhotoReport", "success",
                                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openEntry()
        choosePin()
        let note = app.textViews.firstMatch
        scrollTo(note)
        settle(note)
        XCTAssertFalse(note.label.isEmpty, "The text editor has a VoiceOver label")
        note.tap()
        note.typeText("Entrance sign")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        screenshot("report-ux-06-large-text-keyboard-fixture")
        // The close action preserves text even while the keyboard is up; reopening must not clear the draft.
        app.buttons["閉じる"].firstMatch.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForNonExistence(timeout: 10))
        openEntry()
        scrollTo(app.textViews.firstMatch)
        XCTAssertTrue((app.textViews.firstMatch.value as? String)?.contains("Entrance sign") == true)
        screenshot("report-ux-07-large-text-draft-fixture")
    }
    func testUnconfirmedDeliveryRetriesSavedReportWithoutStartingAnother() {
        launch(extraArguments: ["-uiTestPhotoReport", "reportRetry"])
        openEntry()
        choosePin()
        addPhotoAndAgree()
        scrollTo(submit)
        settle(submit)
        submit.tap()
        let retry = app.buttons["report.retrySaved"]
        XCTAssertTrue(retry.waitForExistence(timeout: 15))
        XCTAssertEqual(retry.label, "保存した申請を再送信")
        XCTAssertFalse(submit.exists && submit.isEnabled)
        screenshot("report-ux-08-unconfirmed-delivery-fixture")
        scrollTo(retry)
        settle(retry)
        retry.tap()
        app.buttons["report.retrySaved.confirm"].firstMatch.tap()
        XCTAssertTrue(app.buttons["下書きを破棄"].waitForNonExistence(timeout: 15))
        let pending = app.descendants(matching: .any)["report.pendingReview"]
        scrollTo(pending)
        XCTAssertTrue(textContaining("rp_UITEST1").exists)
        XCTAssertFalse(textContaining("rp_UITEST2").exists)
        XCTAssertFalse(submit.exists)
        screenshot("report-ux-09-retry-received-fixture")
    }

    // Audits accessible names and roles; this does not replace listening to VoiceOver or testing its gestures.
    func testReportFormAccessibilityNamesAndTraits() throws {
        launch(extraArguments: ["-uiTestPhotoReport", "success"])
        openEntry()
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .trait])
        pinButton.tap()
        let center = app.buttons["report.pin.useCenter"]
        XCTAssertTrue(center.waitForExistence(timeout: 10))
        settle(center)
        center.tap()
        let confirm = app.buttons["report.pin.confirm"]
        scrollTo(confirm)
        settle(confirm)
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .trait])
        confirm.tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForNonExistence(timeout: 10))
        addPhotoAndAgree()
        scrollTo(submit)
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .trait])
        settle(submit)
        submit.tap()
        let pending = app.descendants(matching: .any)["report.pendingReview"]
        XCTAssertTrue(pending.waitForExistence(timeout: 15))
        let photoReceipt = app.descendants(matching: .any)["report.photo.receivedSummary"]
        scrollTo(photoReceipt)
        try app.performAccessibilityAudit(for: [.sufficientElementDescription, .trait])
    }

    // A partially exposed row can be hittable on iOS 18 while its center lies below the viewport.
    private func fullyRevealInFrontmostForm(_ control: XCUIElement) {
        let form = app.collectionViews.element(boundBy: app.collectionViews.count - 1)
        var drags = 0
        while (!control.exists || !form.frame.contains(control.frame)) && drags < 10 {
            let start = form.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.8))
            start.press(forDuration: 0.05, thenDragTo: form.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.3)))
            drags += 1
        }
        XCTAssertTrue(control.exists && form.frame.contains(control.frame), "Control must be fully visible before tapping")
    }

    func testLargestTextKeepsUnconfirmedSubmissionAndRetryReachable() {
        launch(extraArguments: ["-uiTestPhotoReport", "reportRetry",
                                "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        openEntry()
        choosePin()
        addPhotoAndAgree()
        let note = app.textViews.firstMatch
        scrollTo(note, upwards: true)
        settle(note)
        note.tap()
        note.typeText("Saved before retry")
        let done = app.buttons["report.note.done"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        settle(done)
        screenshot("report-ux-20-note-done-fixture")
        done.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        scrollTo(submit)
        fullyRevealInFrontmostForm(submit)
        settle(submit)
        submit.tap()
        let retry = app.buttons["report.retrySaved"]
        XCTAssertTrue(submit.waitForNonExistence(timeout: 15), "Unconfirmed delivery uses its dedicated retry instead")
        scrollTo(retry)
        fullyRevealInFrontmostForm(retry)
        settle(retry)
        XCTAssertFalse(retry.label.isEmpty)
        XCTAssertGreaterThanOrEqual(retry.frame.height, 44)
        screenshot("report-ux-17-large-text-unconfirmed-fixture")
        // Frozen inputs are reviewed, not edited: require a visible value, not an enabled/hittable editor.
        // iOS 18 also exposes the underlying search sheet; the presented Form is frontmost.
        XCTAssertGreaterThan(app.collectionViews.count, 0)
        let form = app.collectionViews.element(boundBy: app.collectionViews.count - 1)
        XCTAssertTrue(form.buttons["report.retrySaved"].exists)
        let savedNote = app.textViews.firstMatch
        var reviewDrags = 0
        while (!savedNote.exists || savedNote.frame.intersection(form.frame).height < 44) && reviewDrags < 10 {
            form.swipeDown()
            reviewDrags += 1
        }
        XCTAssertTrue(savedNote.exists)
        XCTAssertGreaterThanOrEqual(savedNote.frame.intersection(form.frame).height, 44)
        XCTAssertTrue((savedNote.value as? String)?.contains("Saved before retry") == true)
        scrollTo(retry)
        fullyRevealInFrontmostForm(retry)
        settle(retry)
        retry.tap()
        let confirm = app.buttons["report.retrySaved.confirm"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 5))
        confirm.tap()
        let pending = app.descendants(matching: .any)["report.pendingReview"]
        XCTAssertTrue(pending.waitForExistence(timeout: 15))
        XCTAssertFalse(submit.exists)
        screenshot("report-ux-18-large-text-received-fixture")
    }

    func testPausedIntakeDoesNotAdvertiseAddingAPlace() {
        launch(extraArguments: ["-uiTestPhotoReport", "closed"])
        let entry = app.buttons["mapReportButton"]
        XCTAssertTrue(entry.waitForExistence(timeout: 90))
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 30))
        settle(entry)
        XCTAssertTrue(entry.label.contains("新規申請の受付停止中"))
        screenshot("report-ux-10-paused-entry-fixture")
        entry.tap()
        XCTAssertTrue(app.descendants(matching: .any)["report-new-spot-closed"].waitForExistence(timeout: 10))
        scrollTo(submit)
        XCTAssertFalse(submit.exists && submit.isEnabled)
        screenshot("report-ux-11-paused-form-fixture")
    }

    func testEnglishIntroductionRetainsAccessibleControls() {
        launch(extraArguments: ["-uiTestPhotoReport", "success", "-AppleLanguages", "(en)", "-AppleLocale", "en_US"])
        let entry = app.buttons["mapReportButton"]
        XCTAssertTrue(entry.waitForExistence(timeout: 90))
        settle(entry)
        XCTAssertTrue(entry.label.contains("Add a smoking place"))
        entry.tap()
        XCTAssertTrue(app.navigationBars["Add a place"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["report.newPlace.introduction"].exists)
        XCTAssertFalse(pinButton.label.isEmpty)
        screenshot("report-ux-12-english-introduction-fixture")
    }

    func testEntryMovesWithSheetAndStepsAsideForSearch() {
        launch(extraArguments: ["-uiTestPhotoReport", "success"])
        let mapEntry = app.buttons["mapReportButton"]
        XCTAssertTrue(mapEntry.waitForExistence(timeout: 90))
        let navigation = app.navigationBars["近くの場所"]
        XCTAssertTrue(navigation.waitForExistence(timeout: 30))
        settle(mapEntry)
        XCTAssertGreaterThanOrEqual(mapEntry.frame.height, 44)
        screenshot("report-ux-13-map-entry-fixture")
        navigation.swipeDown()
        settle(mapEntry)
        XCTAssertGreaterThanOrEqual(mapEntry.frame.height, 44)
        screenshot("report-ux-16-collapsed-sheet-entry-fixture")
        navigation.swipeUp()
        let bar = app.buttons["sheetReportButton"]
        if !bar.waitForExistence(timeout: 3) { navigation.swipeUp() }
        XCTAssertTrue(bar.waitForExistence(timeout: 10))
        settle(bar)
        XCTAssertGreaterThanOrEqual(bar.frame.height, 44)
        XCTAssertFalse(mapEntry.exists)
        screenshot("report-ux-14-large-sheet-entry-fixture")
        destinationSearch.tap()
        destinationSearch.typeText("上野")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
        XCTAssertTrue(bar.waitForNonExistence(timeout: 10))
        XCTAssertFalse(mapEntry.exists)
        screenshot("report-ux-15-search-keyboard-fixture")
    }

}
