resource s3-website
  bucket name = "jenngen-website"
  access = public

  website {
    index_document = "index.html"
    error_document = "error.html"
  }

... insert other requried resources ...
