.PHONY: contract apple-validate apple-beta-preflight api-validate security-validate validate

contract:
	./scripts/check-doc-contract.sh

apple-validate:
	./scripts/validate-apple.sh

apple-beta-preflight:
	./scripts/apple-beta-preflight.sh

api-validate:
	./scripts/validate-api.sh

security-validate:
	python3 scripts/test-security-guardrails.py
	python3 scripts/security-secret-scan.py
	cd services/api && node --experimental-strip-types --experimental-sqlite --no-warnings --test test/release-security.test.ts test/deploy-config.test.ts

validate: contract api-validate apple-validate security-validate
