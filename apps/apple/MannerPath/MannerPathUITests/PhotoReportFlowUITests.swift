import XCTest

// v1.0 photo-report form flow against the DEBUG-only UI-test report stack (`-uiTestPhotoReport <scenario>`): a
// deployment that advertises photo intake, a fake App Attest authorizer and a scripted uploader. Needs no Worker,
// and never reaches a real report or photo endpoint. Selection/upload tests use the stack's "add test photo"
// button, which exists only in that DEBUG composition; the native picker smoke test opens and cancels without
// reading, selecting or changing library photos. These diagnostic captures are fixtures, not submission assets.
final class I_PhotoReportFlowUITests: MannerPathUITestCase {
    func openNewPlaceForm(_ scenario: String) {
        launch(extraArguments: ["-uiTestPhotoReport", scenario])
        // The entry copy can differ from the form title; use the shipped map-entry contract.
        // Launch reads availability from the stack; a loaded Simulator can take well over 30 s to show the entry.
        tapMapEntryWhenSettled()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
    }

    /// The map entry appears as soon as availability loads, which can be while the Nearby sheet is still being
    /// presented; a tap in that transition can be lost. Tap only once the sheet is up and the button has stopped moving.
    func tapMapEntryWhenSettled(file: StaticString = #filePath, line: UInt = #line) {
        let add = app.buttons["mapReportButton"]
        XCTAssertTrue(add.waitForExistence(timeout: 90), file: file, line: line)
        XCTAssertTrue(app.navigationBars["近くの場所"].waitForExistence(timeout: 30), file: file, line: line)
        waitUntilSettled(add, file: file, line: line)
        add.tap()
    }

    /// Waits until the element is enabled, hittable and its frame is unchanged between two reads. A tap that lands
    /// while a list is still decelerating or a sheet is still animating only stops the motion; nothing is activated.
    func waitUntilSettled(_ element: XCUIElement, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        let deadline = Date().addingTimeInterval(timeout)
        var last = CGRect.null
        while Date() < deadline {
            let frame = element.exists ? element.frame : .null
            if frame == last, element.isEnabled, element.isHittable { return }
            last = frame
            RunLoop.current.run(until: Date().addingTimeInterval(0.2))
        }
        XCTFail("\(element) did not settle within \(timeout) s; last frame \(last)", file: file, line: line)
    }

    func choosePinAndAgree() {
        app.buttons["地図でピンを選ぶ"].tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForExistence(timeout: 10))
        app.buttons["地図の中心を使用"].tap()
        let confirm = app.buttons["提案するピンを確定"]
        scrollTo(confirm)
        confirm.tap()
        let agree = app.switches["報告に関する規約に同意する"]
        // The pin sheet's dismissal reflows the Form; scrolling then leaves it decelerating. Tap the switch only once
        // it is still, then require the toggle to report ON: every later step depends on consent.
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForNonExistence(timeout: 10))
        scrollTo(agree)
        let control = agree.switches.firstMatch.exists ? agree.switches.firstMatch : agree
        waitUntilSettled(control)
        control.tap()
        let on = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1'"), object: agree)
        XCTAssertEqual(XCTWaiter().wait(for: [on], timeout: 5), .completed, "consent toggle must be ON after one tap")
    }

    var submit: XCUIElement { app.buttons["report.submit"] }

    func submitOnceAndWaitForReceipt(file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.buttons["下書きを破棄"].exists, file: file, line: line)
        // XCTest can call a partially clipped last Form row hittable (observed y=836, h=44 on an 852pt screen).
        // Move the entire button clear of the home-indicator edge before the one and only submit tap.
        let safeFrame = app.frame.insetBy(dx: 0, dy: 44)
        for _ in 0..<4 where !safeFrame.contains(submit.frame) {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.75)).press(forDuration: 0.05,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.02, dy: 0.35)))
        }
        let frame = submit.frame
        guard safeFrame.contains(frame), submit.isEnabled, submit.isHittable else {
            screenshot("fixture-only-submit-clipped-not-for-submission")
            XCTFail("Submit must be fully visible before tapping. Frame: \(frame)", file: file, line: line)
            return
        }
        submit.tap()
        // Acceptance removes the draft toolbar action. Observe that transition before scrolling a reflowed Form;
        // never hide a missed action or an unresolved submission by blindly tapping submit again.
        guard app.buttons["下書きを破棄"].waitForNonExistence(timeout: 15) else {
            screenshot("fixture-only-submission-no-receipt-not-for-submission")
            let tree = XCTAttachment(string: app.debugDescription)
            tree.name = "fixture-only-submission-no-receipt-tree"
            tree.lifetime = .keepAlways
            add(tree)
            XCTFail("A single submit tap did not reach receipt state. Submit frame: \(frame)", file: file, line: line)
            return
        }
    }

    func addPhotos(_ count: Int) {
        let add = app.buttons["report.photo.addTest"]
        for _ in 0..<count {
            // Photos precede consent/submit and the growing preview list. A tap during the scroll's deceleration
            // only stops it, so tap once the button is still. Previews below the fold are not in the tree, so the
            // count is checked by the callers' visible outcomes (no fourth add, enabled submit).
            scrollTo(add, upwards: true)
            waitUntilSettled(add)
            add.tap()
        }
    }

    func testNativePhotosPickerCancelReturnsToUnchangedForm() {
        openNewPlaceForm("success")
        choosePinAndAgree()
        let choose = app.buttons["report.photo.choose"]
        scrollTo(choose, upwards: true)
        choose.tap()
        let cancel = app.buttons.matching(NSPredicate(format: "label == 'キャンセル' OR label == 'Cancel'")).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 20), "The real system photo picker must offer cancellation")
        cancel.tap()
        XCTAssertTrue(cancel.waitForNonExistence(timeout: 10))
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].exists)
        scrollTo(choose, upwards: true)
        XCTAssertTrue(choose.isEnabled && choose.isHittable, "The form must remain usable after cancellation")
        XCTAssertFalse(app.buttons["report.photo.remove"].exists)
        XCTAssertFalse(textContaining("選択した写真").exists)
        XCTAssertFalse(textContaining("Selected photo").exists)
        scrollTo(submit)
        XCTAssertFalse(submit.isEnabled, "Cancelling must not satisfy the required photo selection")
        // Capture only the fixture form after dismissal; do not capture any existing library contents.
        screenshot("fixture-only-native-photo-picker-cancelled-not-for-submission")
    }

    func testNewPlaceRequiresPhotosThenSendsReportAndPhotos() {
        openNewPlaceForm("success")
        choosePinAndAgree()
        let required = text("3. 写真を添付（必須・1〜3枚）")
        scrollTo(required, upwards: true)
        scrollTo(textContaining("位置情報は使用しません"))
        scrollTo(submit)
        XCTAssertFalse(submit.isEnabled, "a new place cannot be submitted without a photo")
        screenshot("60-photo-required")
        addPhotos(3)
        XCTAssertFalse(app.buttons["report.photo.addTest"].exists, "no fourth photo can be added")
        let remove = app.buttons["report.photo.remove"].firstMatch
        scrollTo(remove)
        screenshot("61-photo-preview")
        remove.tap()
        XCTAssertEqual(app.buttons.matching(identifier: "report.photo.remove").count, 2)
        addPhotos(1)
        scrollTo(submit)
        if !submit.isEnabled {
            // Say why before failing: consent, photo count and the whole form, so an intermittent miss has a cause.
            let consent = app.switches["報告に関する規約に同意する"]
            let tree = XCTAttachment(string: "consent=\(consent.exists ? String(describing: consent.value) : "absent") " +
                "photos=\(app.buttons.matching(identifier: "report.photo.remove").count)\n" + app.debugDescription)
            tree.name = "submit-disabled-tree"
            tree.lifetime = .keepAlways
            add(tree)
        }
        XCTAssertTrue(submit.isEnabled)
        submitOnceAndWaitForReceipt()
        // Acceptance removes the draft/submit section. Return to the photos above the retained scroll position,
        // then continue down to the thanks copy, shown only once every photo is received.
        scrollTo(text("写真を受け付けました（審査待ち）"), upwards: true)
        let thanks = textContaining("報告ありがとうございます")
        scrollTo(thanks)
        XCTAssertFalse(app.buttons["report.photo.retry"].exists)
        screenshot("62-photo-all-sent")
    }

    func testPhotoFailureShowsReasonAndRetriesOnlyPhotos() {
        openNewPlaceForm("retry")
        choosePinAndAgree()
        addPhotos(2)
        scrollTo(submit)
        submitOnceAndWaitForReceipt()
        let retry = app.buttons["report.photo.retry"]
        scrollTo(textContaining("通信の問題で、この写真が届いたか確認できませんでした"), upwards: true)
        scrollTo(textContaining("2枚のうち2枚は受信を確認できていません"))
        XCTAssertFalse(textContaining("報告ありがとうございます").exists)
        scrollTo(retry, upwards: true)
        screenshot("63-photo-failed")
        retry.tap()
        scrollTo(textContaining("報告ありがとうございます"))
        XCTAssertFalse(retry.exists)
        screenshot("64-photo-retried")
    }

    func testExpiredReportOffersNoRetry() {
        openNewPlaceForm("expired")
        choosePinAndAgree()
        addPhotos(1)
        scrollTo(submit)
        submitOnceAndWaitForReceipt()
        XCTAssertTrue(textContaining("写真を追加できる期限が過ぎました").waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["report.photo.retry"].exists)
        XCTAssertTrue(textContaining("1枚のうち1枚は受信を確認できていません").exists)
        screenshot("65-photo-expired")
    }

    func testClosedPhotoIntakeBlocksNewPlaces() {
        launch(extraArguments: ["-uiTestPhotoReport", "closed"])
        // The entry stays visible but explains the pause; no new-place draft, form or submit is reachable.
        tapMapEntryWhenSettled()
        let alert = app.alerts["現在、申請受付を停止しています"]
        XCTAssertTrue(alert.waitForExistence(timeout: 10))
        XCTAssertTrue(alert.staticTexts["現在、新しい喫煙所の報告を受け付けていません。"].exists)
        screenshot("66-new-spot-closed")
        assertIntakePausedAlert()
        XCTAssertFalse(submit.exists)
        XCTAssertFalse(app.buttons["下書きを破棄"].exists)
    }

    // MARK: Interrupted uploads (resume after relaunch)

    func launchPersistent(_ scenario: String, reset: Bool = false, extraArguments: [String] = []) {
        launch(extraArguments: ["-uiTestPhotoReport", scenario, "-uiTestReportPersistent", "YES"]
               + (reset ? ["-uiTestReportReset", "YES"] : []) + extraArguments)
    }

    /// Submits a new place with one photo whose upload never finishes, then terminates the app mid-upload.
    func submitAndTerminateDuringUpload(_ scenario: String = "hang") {
        launchPersistent(scenario, reset: true)
        tapMapEntryWhenSettled()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
        choosePinAndAgree()
        addPhotos(1)
        scrollTo(submit)
        submitOnceAndWaitForReceipt()
        XCTAssertTrue(textContaining("写真を送信").waitForExistence(timeout: 10), "terminated while the photo is in flight")
        app.terminate()
    }

    /// The map entry after a relaunch: with a report still waiting for photos, the form opens on a choice.
    func tapMapEntryAndExpectChoice(file: StaticString = #filePath, line: UInt = #line) {
        tapMapEntryWhenSettled(file: file, line: line)
        XCTAssertTrue(text("前回の報告が残っています").waitForExistence(timeout: 10), file: file, line: line)
        // Form rows below the fold are absent from the accessibility tree until scrolled to (large text sizes).
        scrollTo(app.buttons["report.followUp.resume"], file: file, line: line)
        scrollTo(app.buttons["report.followUp.newReport"], file: file, line: line)
        XCTAssertFalse(app.buttons["report.submit"].exists, "nothing is started before the user chooses", file: file, line: line)
    }

    func continuePreviousReport() {
        tapMapEntryAndExpectChoice()
        resumeFollowUp()
        scrollTo(app.descendants(matching: .any)["report-photo-follow-up"], upwards: true)
    }

    /// One tap on "resume" once it is still; the choice must then leave. The follow-up form's rows may be off-screen.
    func resumeFollowUp() {
        let resume = app.buttons["report.followUp.resume"]
        waitUntilSettled(resume)
        resume.tap()
        XCTAssertTrue(resume.waitForNonExistence(timeout: 10))
    }

    func testRelaunchOffersResumeAndSendsPhotoToTheSameReport() {
        submitAndTerminateDuringUpload()
        launchPersistent("success")
        tapMapEntryAndExpectChoice()
        XCTAssertTrue(textContaining("rp_UITEST1").exists)
        screenshot("70-photo-resume-choice")
        // Closing without a choice keeps the follow-up.
        app.buttons["閉じる"].firstMatch.tap()
        XCTAssertTrue(text("前回の報告が残っています").waitForNonExistence(timeout: 10))
        // Scrolling this row may expand Nearby to large, where the map entry correctly disappears.
        // Resume from the in-list entry we just revealed instead of waiting for the hidden map entry.
        let resume = app.buttons["resumeReportPhotos"]
        scrollTo(resume)
        waitUntilSettled(resume)
        resume.tap()
        scrollTo(app.descendants(matching: .any)["report-photo-follow-up"], upwards: true)
        XCTAssertTrue(textContaining("写真は端末に保存されないため").exists)
        XCTAssertTrue(textContaining("rp_UITEST1").exists, "the follow-up keeps the received report's reference")
        XCTAssertTrue(textContaining("0 / 3").exists, "no photo was confirmed before the app closed")
        XCTAssertTrue(textContaining("確認できないまま届いている場合があります").exists, "a lost answer is explained, not counted")
        screenshot("71-photo-resume-offered")
        scrollTo(app.buttons["report.photo.addTest"])
        addPhotos(1)
        let send = app.buttons["report.photo.sendResumed"]
        scrollTo(send)
        send.tap()
        XCTAssertTrue(text("写真を受け付けました（審査待ち）").waitForExistence(timeout: 20))
        XCTAssertFalse(textContaining("rp_UITEST2").exists, "resending photos never creates a second report")
        XCTAssertFalse(app.buttons["report.submit"].exists, "the report itself is not offered for resubmission")
        scrollTo(app.buttons["report.photo.choose"], upwards: true)
        XCTAssertTrue(app.descendants(matching: .any)["report.photo.preparationNotice"].exists,
                      "Resumed uploads retain the privacy reminder while more photos can still be selected")
        XCTAssertFalse(app.descendants(matching: .any)["report.photo.receivedSummary"].exists)
        screenshot("72-photo-resume-sent")
    }

    func testStoppingTheFollowUpStartsANewReport() {
        submitAndTerminateDuringUpload()
        launchPersistent("success")
        tapMapEntryAndExpectChoice()
        app.buttons["report.followUp.newReport"].tap()
        let notice = app.descendants(matching: .any)["report.followUp.newReportNotice"]
        XCTAssertTrue(notice.waitForExistence(timeout: 10))
        XCTAssertTrue(notice.label.contains("削除されません"), "ending photo follow-up never reads as deleting the report")
        screenshot("73-photo-resume-new-report-confirm")
        app.buttons["report.followUp.confirmNewReport"].tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
        XCTAssertFalse(text("前回の報告が残っています").exists)
        choosePinAndAgree()
        addPhotos(1)
        scrollTo(submit)
        submitOnceAndWaitForReceipt()
        scrollTo(textContaining("rp_UITEST2"))
        XCTAssertFalse(textContaining("rp_UITEST3").exists)
    }

    func testResumeExplainsPausedIntakeAndConnectionFailure() {
        submitAndTerminateDuringUpload()
        launchPersistent("closed")
        continuePreviousReport()
        let paused = app.descendants(matching: .any)["report-photo-intake-paused"].firstMatch
        XCTAssertTrue(paused.waitForExistence(timeout: 10))
        XCTAssertTrue(app.frame.contains(paused.frame), "the pause is explained on the first screen")
        XCTAssertTrue(paused.label.contains("写真の受付を一時停止しています"))
        screenshot("74-photo-resume-paused")
        app.terminate()

        launchPersistent("offline")
        continuePreviousReport()
        XCTAssertTrue(textContaining("rp_UITEST1").exists, "a paused intake kept the follow-up")
        scrollTo(app.buttons["report.photo.addTest"])
        addPhotos(1)
        let send = app.buttons["report.photo.sendResumed"]
        scrollTo(send)
        send.tap()
        let failure = textContaining("通信の問題で、この写真が届いたか確認できませんでした")
        XCTAssertTrue(failure.waitForExistence(timeout: 20))
        XCTAssertTrue(textContaining("二重に保存されることはありません").exists)
        scrollTo(app.buttons["report.photo.retry"])
        screenshot("75-photo-resume-offline")
    }

    func testExpiredFollowUpSaysSoAndOffersNoSending() {
        submitAndTerminateDuringUpload("old")
        launchPersistent("success")
        let entry = app.buttons["resumeReportPhotos"]
        scrollTo(entry)
        entry.tap()
        XCTAssertTrue(app.descendants(matching: .any)["report-photo-follow-up-expired"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["report.photo.addTest"].exists)
        XCTAssertFalse(app.buttons["report.photo.sendResumed"].exists)
        scrollTo(app.buttons["report.photo.endFollowUp"])
        screenshot("76-photo-resume-expired")
    }

    func testUnsavedFollowUpWarnsToKeepTheAppOpen() {
        launchPersistent("unsaved", reset: true)
        tapMapEntryWhenSettled()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
        choosePinAndAgree()
        addPhotos(1)
        scrollTo(submit)
        submitOnceAndWaitForReceipt()
        let warning = app.descendants(matching: .any)["report-photo-follow-up-not-saved"].firstMatch
        XCTAssertTrue(warning.waitForExistence(timeout: 10))
        XCTAssertTrue(app.frame.contains(warning.frame), "the warning is on screen right after acceptance")
        XCTAssertTrue(warning.label.contains("アプリを閉じないでください"))
        screenshot("77-photo-follow-up-not-saved")
    }

    func testResumeScreenWorksAtLargestTextSizeWithLabels() {
        submitAndTerminateDuringUpload()
        launchPersistent("success", extraArguments: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"])
        tapMapEntryAndExpectChoice()
        // VoiceOver reads each control by its visible text; none may be icon-only. The title is checked by the helper.
        for id in ["report.followUp.resume", "report.followUp.newReport"] {
            let button = app.buttons[id]
            scrollTo(button)
            XCTAssertFalse(button.label.isEmpty, "\(id) needs a spoken label")
        }
        screenshot("78-photo-resume-choice-xxxl")
        resumeFollowUp()
        // The choice leaves and the follow-up form takes its place. Depending on the retained offset its rows can sit
        // above or below the visible area at this size, and off-screen rows are absent from the tree: scroll to them.
        scrollTo(app.descendants(matching: .any)["report-photo-follow-up"], upwards: true)
        // Top to bottom: "end follow-up" sits above the photo section.
        for id in ["report.photo.endFollowUp", "report.photo.addTest"] {
            let button = app.buttons[id]
            scrollTo(button)
            XCTAssertFalse(button.label.isEmpty, "\(id) needs a spoken label")
        }
        screenshot("79-photo-resume-xxxl")
    }
}
