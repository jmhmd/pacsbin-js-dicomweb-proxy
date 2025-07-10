# Plan for application

I would like to use this pure-js implementation of DICOM DIMSE (dcmjs-dimse, an
installed package in node_modules) to create a proxy server that translates
incoming dicomweb requests to DIMSE, then translates the returned DIMSE response
to dicomweb, and forwards back to the client. I want to use as few external
dependencies as possible, however an http server such as hono.js might be
helpful, unless you think it is just as simple to implement from bun or nodejs
primitives.

Find the source of the dcmjs-dimse library in ./dcmjs-dimse for reference, but
the library should probably be used from the built node_modules version.

This application is meant to be deployed on hospital networks, which are
generally closed to incoming internet requests, and will probably run on red hat
enterprise linux.

I would like to be able to compile this to a single binary using bun or deno,
for ease of deployment. A configuration JSON file should live alongside the
binary.

Favor keeping this package as lean as possible, with limited external libraries.

Requirements:
- Simple installation and configuration. Ideally a single binary with a
  configuration file or files alongside the binary that could be run from the
  user's home directory.
- Example configuration options in the file at ./config/example-config.jsonc
  - If additional configuration options are required during development, ask about adding them.
- Must be able to configure CORS headers
- Must be able to add a custom SSL certificate to enable https for the
  webserver. This is installed within a closed network, so services like Let's
  Encrypt do not work. Ideally, you could simply put a cert/key combo or whatever is
  needed for SSL alongside the binary, and it would pick them up and use them
  with minimal configuration. Using self-signed certs should also be an option
  as a fallback.
- Only QIDO and WADO requests need to be supported, not STOW or any others. I do
  not need to support transcoding images between different transfer syntaxes.
  This is a focused implementation that only needs to support querying for study
  metadata via QIDO, and retrieving DICOM part10 instances via WADO. Images
  pulled via C-MOVE or C-GET can be stored in a local cache and forwarded as is
  in the dicomweb response. The cache retention time and max size should be
  configurable.
- Keep code well-documented and idiomatic
- Use typescript
- Favor simplicity, and ask about adding features before implementing