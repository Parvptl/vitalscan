"""VitalScan FastAPI application entry point."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.routes import router
from .config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("vitalscan")

app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description=(
        "Camera-based rPPG analysis API. Implements the pipeline defined in "
        "reference/Finger_Pulse_rPPG_Analysis_New.ipynb. Research prototype - "
        "not a medical device."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

app.include_router(router)


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """Return a clean message instead of leaking internal validation structure."""
    first = exc.errors()[0] if exc.errors() else {}
    message = first.get("msg", "The measurement payload was rejected.")
    message = message.replace("Value error, ", "")
    return JSONResponse(
        status_code=422,
        content={"status": "error", "code": "invalid_payload", "message": message},
    )


@app.exception_handler(Exception)
async def unhandled_handler(_request: Request, exc: Exception) -> JSONResponse:
    """Never surface a Python traceback to the client."""
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(
        status_code=500,
        content={
            "status": "error",
            "code": "internal_error",
            "message": "Something went wrong while processing the measurement.",
        },
    )


@app.get("/")
def root() -> dict[str, str]:
    return {"name": settings.app_name, "version": settings.version, "docs": "/docs"}
