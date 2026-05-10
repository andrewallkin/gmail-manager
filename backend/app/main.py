import logging
import logging.config
from contextlib import asynccontextmanager

from fastapi import FastAPI


def _configure_logging() -> None:
    from app.config import get_settings
    log_level = get_settings().log_level.upper()
    logging.config.dictConfig({
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "standard": {
                "format": "%(asctime)s  %(levelname)-8s [%(name)-14s] %(message)s",
                "datefmt": "%Y-%m-%d %H:%M:%S",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "standard",
            },
        },
        "loggers": {
            "uvicorn":        {"handlers": ["console"], "level": log_level, "propagate": False},
            "uvicorn.error":  {"handlers": ["console"], "level": log_level, "propagate": False},
            "uvicorn.access": {"handlers": ["console"], "level": log_level, "propagate": False},
            "auth":           {"handlers": ["console"], "level": log_level, "propagate": False},
            "labels":         {"handlers": ["console"], "level": log_level, "propagate": False},
            "rules":          {"handlers": ["console"], "level": log_level, "propagate": False},
            "cleanup":        {"handlers": ["console"], "level": log_level, "propagate": False},
            "gmail":          {"handlers": ["console"], "level": log_level, "propagate": False},
            "settings":       {"handlers": ["console"], "level": log_level, "propagate": False},
            "poller":         {"handlers": ["console"], "level": log_level, "propagate": False},
            "ai":             {"handlers": ["console"], "level": log_level, "propagate": False},
        },
        "root": {"handlers": ["console"], "level": "WARNING"},
    })


_configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.poller import start_poller, stop_poller
    start_poller()
    yield
    stop_poller()


app = FastAPI(title="Gmail Manager", lifespan=lifespan)

from app.routers.auth import logout_router, router as auth_router
from app.routers.cleanup import router as cleanup_router
from app.routers.labels import router as labels_router
from app.routers.restore import router as restore_router
from app.routers.rules import router as rules_router
from app.routers.settings import router as settings_router
from app.routers.debug_gmail import router as debug_gmail_router

app.include_router(auth_router)
app.include_router(logout_router)
app.include_router(labels_router)
app.include_router(rules_router)
app.include_router(cleanup_router)
app.include_router(restore_router)
app.include_router(settings_router)
app.include_router(debug_gmail_router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}
