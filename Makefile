.PHONY: contract apple-validate apple-beta-preflight api-validate validate

contract:
	./scripts/check-doc-contract.sh

apple-validate:
	./scripts/validate-apple.sh

apple-beta-preflight:
	./scripts/apple-beta-preflight.sh

api-validate:
	./scripts/validate-api.sh

validate: contract api-validate apple-validate
