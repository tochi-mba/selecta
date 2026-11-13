# Historical hosted worker — do not remove yet

services/worker/Dockerfile and models.lock.json define an existing cloud worker
runtime with model weight and licence dependencies. The new local-first architecture
targets retirement of remote CPU/GPU/export DSP after real-device parity, retrieval,
job drainage, model distribution rights and rollback gates are independently proved.

This branch only inventories these files. No image, model, deployment, gateway or
customer job is disabled. The future local installer is owned by Agent 01 and the
local DSP scheduler by Agent 05; no worker model should be moved into a local
distribution until the licence register and territory rights have been reviewed.
