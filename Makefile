deploy:
	@echo "Deploying website..."
	@cd dist && terraform init
	@cd dist && terraform apply -auto-approve
	@echo "Deployed website!"

default: deploy