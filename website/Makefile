# Makefile for deploying the website with Terraform

deploy:
	"Deploying website..."
	cd dist
	terraform init
	terraform apply -auto-approve
	"Deployed website!"

default=deploy
