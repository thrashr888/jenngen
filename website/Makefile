
target deploy:
	@echo "Deploying website..."
	@cd dist && terraform init && terraform apply -auto-approve
	@echo "Deployed website!"

default=deploy