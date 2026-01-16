terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 3.0"
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
  }
}

# Create a CloudFront distribution for the S3 bucket
resource "aws_cloudfront_distribution" "jenngen-website-cdn" {
  origin {
    domain_name = aws_s3_bucket.jenngen-website.bucket_regional_domain_name
    origin_id   = "S3-jenngen-website"
  }

  enabled             = true
  default_root_object = "index.html"

  default_cache_behavior {
    target_origin_id = "S3-jenngen-website"
    
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD", "OPTIONS"]

    forwarded_values {
      query_string = false

      cookies {
        forward = "none"
      }
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = {
    Name = "jenngen-website-cdn"
  }
}