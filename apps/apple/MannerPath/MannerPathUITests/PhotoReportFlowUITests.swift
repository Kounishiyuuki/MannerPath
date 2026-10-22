import XCTest

// v1.0 photo-report form flow against the DEBUG-only UI-test report stack (`-uiTestPhotoReport <scenario>`): a
// deployment that advertises photo intake, a fake App Attest authorizer and a scripted uploader. Needs no Worker,
// and never reaches a real report or photo endpoint. The photo library is not scriptable, so photos come from the
// stack's "add test photo" button, which exists only in that DEBUG composition.
final class I_PhotoReportFlowUITests: MannerPathUITestCase {
    func openNewPlaceForm(_ scenario: String) {
        launch(extraArguments: ["-uiTestPhotoReport", scenario])
        let add = app.buttons.matching(NSPredicate(format: "label == '喫煙場所を追加'")).firstMatch
        // Launch reads availability from the stack; a loaded Simulator can take well over 30 s to show the entry.
        XCTAssertTrue(add.waitForExistence(timeout: 90))
        add.tap()
        XCTAssertTrue(app.navigationBars["喫煙場所を追加"].waitForExistence(timeout: 10))
    }

    func choosePinAndAgree() {
        app.buttons["地図でピンを選ぶ"].tap()
        XCTAssertTrue(app.navigationBars["提案するピンを選ぶ"].waitForExistence(timeout: 10))
        app.buttons["地図の中心を使用"].tap()
        let confirm = app.buttons["提案するピンを確定"]
        scrollTo(confirm)
        confirm.tap()
        let agree = app.switches["報告に関する規約に同意する"]
        scrollTo(agree)
        agree.switches.firstMatch.exists ? agree.switches.firstMatch.tap() : agree.tap()
    }

    var submit: XCUIElement { app.buttons["report.submit"] }

    func addPhotos(_ count: Int) {
        let add = app.buttons["report.photo.addTest"]
        for _ in 0..<count {
            scrollTo(add)
            add.tap()
        }
    }

    func testNewPlaceRequiresPhotosThenSendsReportAndPhotos() {
        openNewPlaceForm("success")
        choosePinAndAgree()
        let required = text("写真（必須・1〜3枚）")
        scrollTo(required)
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
        XCTAssertTrue(submit.isEnabled)
        submit.tap()
        // Photos, then the status row, sit below the submit button; the Form lays out only what is near the screen, so
        // scrolling down to each is the wait. The thanks copy is shown only once every photo is received.
        scrollTo(text("写真を受け付けました（審査待ち）"))
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
        submit.tap()
        let retry = app.buttons["report.photo.retry"]
        scrollTo(textContaining("通信の問題で写真を送信できませんでした"))
        scrollTo(textContaining("2枚のうち2枚が未送信"))
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
        submit.tap()
        XCTAssertTrue(textContaining("写真を追加できる期限が過ぎました").waitForExistence(timeout: 20))
        XCTAssertFalse(app.buttons["report.photo.retry"].exists)
        XCTAssertTrue(textContaining("1枚のうち1枚が未送信").exists)
        screenshot("65-photo-expired")
    }

    func testClosedPhotoIntakeBlocksNewPlaces() {
        openNewPlaceForm("closed")
        XCTAssertTrue(app.descendants(matching: .any)["report-new-spot-closed"].waitForExistence(timeout: 10))
        XCTAssertTrue(textContaining("現在、新しい喫煙所の報告を受け付けていません").exists)
        XCTAssertFalse(app.buttons["report.photo.addTest"].exists)
        screenshot("66-new-spot-closed")
        choosePinAndAgree()
        scrollTo(submit)
        XCTAssertFalse(submit.isEnabled)
    }
}
