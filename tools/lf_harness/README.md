# LF19 deterministic test harness runner

From the repository root:

```bash
python tools/lf_harness/run.py self-test --out /tmp/selecta-lf19-self-tests.json
python tools/lf_harness/run.py acceptance --out /tmp/selecta-lf19-acceptance.json
# Expected: exit code 2 / BLOCKED until a production integration bridge exists.
```

To run **integrated** tests after other agents implement the contracts, supply
`--adapter your_package:your_adapter --reviewer <independent-person> --evidence-link <run-url>`.
The adapter must implement `tests/lf_harness/acceptance.py:AcceptanceAdapter`; it
must provision real local engines, instrument actual output, and capture cloud
egress without uploading media. It must execute forbidden-payload validation in
an isolated ingress interceptor **before** any network call. Never point the
probe at a production API or an unguarded cloud service.

`acceptance` deliberately exits nonzero / NO-GO for any missing or failing check,
including physical speaker verification, which requires a separate measured
hardware run. A simulated reference takeover never counts as integration PASS.
