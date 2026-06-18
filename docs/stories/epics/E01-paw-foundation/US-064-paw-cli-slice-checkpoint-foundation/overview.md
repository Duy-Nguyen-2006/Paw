
# US-064: Paw CLI Slice Checkpoint Foundation

Expose `paw prepare-checkpoint` as a bounded CLI command that acquires the session
lock, calls `preparePawSliceCheckpoint`, and releases owned locks for applicable
outcomes while preserving live foreign locks at acquire time.
