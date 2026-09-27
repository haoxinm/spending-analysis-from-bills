"""`/api/jobs/{id}` and `/api/jobs/{id}/events` (§3.12, A1, D6).

The SSE stream polls the `jobs` row at ~500 ms, opening and closing a short-lived `Session` on
each poll rather than holding one transaction open across the stream, and emits a terminal event
before closing once the job reaches `done`/`error`/`cancelled`. It handles a client disconnect
(`request.is_disconnected()`) without leaking the generator.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import StreamingResponse

from spend_analyzer.api import schemas
from spend_analyzer.api.deps import SessionDep, SessionFactoryDep
from spend_analyzer.db.models import Job

router = APIRouter(tags=["jobs"])

#: How often the SSE stream re-reads the `jobs` row.
_POLL_INTERVAL_S = 0.5

_TERMINAL_STATUSES = frozenset({"done", "error", "cancelled"})


def _job_response(job: Job) -> schemas.Job:
    progress = (job.done / job.total) if job.total > 0 else (1.0 if job.status == "done" else 0.0)
    message: str | None = None
    if job.result_json:
        try:
            payload = json.loads(job.result_json)
            message = payload.get("message") if isinstance(payload, dict) else None
        except ValueError:  # pragma: no cover - defensive
            message = None
    return schemas.Job(
        id=job.id,
        kind=job.kind,
        status=job.status,
        progress=min(max(progress, 0.0), 1.0),
        message=message,
        group_id=job.llm_run_group_id,
        error_detail=job.error_detail,
    )


@router.get("/jobs/{job_id}", response_model=schemas.Job)
def get_job(job_id: str, session: SessionDep) -> schemas.Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return _job_response(job)


@router.get("/jobs/{job_id}/events")
async def job_events(
    job_id: str,
    request: Request,
    session_factory: SessionFactoryDep,
    token: str | None = None,
) -> StreamingResponse:
    with session_factory() as session:
        if session.get(Job, job_id) is None:
            raise HTTPException(status_code=404, detail="job not found")

    async def event_stream() -> AsyncIterator[str]:
        last_done = -1
        while True:
            if await request.is_disconnected():
                return
            with session_factory() as poll_session:
                job = poll_session.get(Job, job_id)
            if job is None:  # pragma: no cover - defensive; jobs rows are never deleted
                return
            if job.done != last_done or job.status in _TERMINAL_STATUSES:
                last_done = job.done
                yield f"data: {_job_response(job).model_dump_json()}\n\n"
            if job.status in _TERMINAL_STATUSES:
                return
            await asyncio.sleep(_POLL_INTERVAL_S)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
