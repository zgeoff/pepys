The one mock network of a pepys test process. `mockNetwork` answers each `fetch` to a remote host
with the handlers a test gives it, through msw, and answers 500 to a request that no handler
matches. A loopback request passes, so a test can call a server it starts. The test preload in
`bunfig.toml` sets the default handlers and resets them after each test.
