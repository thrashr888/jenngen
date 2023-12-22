terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Configure the AWS Provider
provider "aws" {
  region = "us-east-1"
}

# Create an S3 bucket for the website
resource "aws_s3_bucket" "jenngen-website" {
  bucket = "jenngen-website"
  acl    = "public-read"
  website {
    index_document = "index.html"
    error_document = "error.html"
  }
}

# Create a CloudFront distribution for the website
resource "aws_cloudfront_distribution" "jenngen-website" {
  origin {
    domain_name = aws_s3_bucket.jenngen-website.bucket_regional_domain_name
    origin_id   = aws_s3_bucket.jenngen-website.id
  }
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD", "OPTIONS"]
    target_origin_id = aws_s3_bucket.jenngen-website.id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}