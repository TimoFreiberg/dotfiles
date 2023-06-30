
let-env PATH = ($env.PATH | prepend [
	/opt/homebrew/bin
  /opt/homebrew/opt/openssl@1.1/bin
	/usr/local/google-cloud-sdk/bin
  ~/.cargo/bin
  ~/.local/bin
])
