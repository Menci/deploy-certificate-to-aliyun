# GitHub Action for Aliyun certificate deployment

Deploy SSL certificate to Aliyun Certificates Service (and use in CDN).

# Usage

> If you need to issue SSL certificates automatically, you can use [my acme.sh action](https://github.com/marketplace/actions/issue-ssl-certificate).

This action will deploy your PEM-formatted SSL certificate to Aliyun Certificates Service. And then set to use this certificate in CDN (optional).

According to Aliyun API, both Access Keys and STS Token are accepted as credentials.

```yaml
jobs:
  deploy-to-aliyun:
    name: Deploy certificate to Aliyun
    runs-on: ubuntu-latest
    steps:
      - name: Check out
        uses: actions/checkout@v2
        with:
          # If you just commited and pushed your newly issued certificate to this repo in a previous job,
          # use `ref` to make sure checking out the newest commit in this job
          ref: ${{ github.ref }}
      - uses: Menci/deploy-certificate-to-aliyun@beta-v1
        with:
          # Use Access Key
          access-key-id: ${{ secrets.ALIYUN_ACCESS_KEY_ID }}
          access-key-secret: ${{ secrets.ALIYUN_ACCESS_KEY_SECRET }}
          # Or use STS Token
          # security-token: ${{ secrets.ALIYUN_SECURITY_TOKEN }}

          # Specify PEM fullchain file
          fullchain-file: ${{ env.FILE_FULLCHAIN }}
          # Specify PEM private key file
          key-file: ${{ env.FILE_KEY }}

          # The name in Aliyun Certificates Service
          # Will replace the old one with the same name
          certificate-name: My-SSL

          # (Optional) Deploy to CDN
          cdn-domains: |
            cdn1.example.com
            cdn2.example.com
        
          # (Optional) API request timeout (unit ms)
          timeout: 10000

          # (Optional) API request attempt times
          retry: 3
```
