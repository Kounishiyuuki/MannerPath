.PHONY: contract apple-validate api-validate validate

contract:
	./scripts/check-doc-contract.sh

apple-validate:
	./scripts/validate-apple.sh

api-validate:
	./scripts/validate-api.sh

validate: contract api-validate apple-validate
