import { DrizzleUoW, DrizzleReadOnly } from "./uow/drizzle-uow";
import type { UnitOfWork } from "./uow/types";
import type { ReadOnlyExecutor } from "./uow/types";

export interface Deps {
  uow: UnitOfWork;
  readOnly: ReadOnlyExecutor;
}

let _deps: Deps | null = null;

export function makeDeps(): Deps {
  if (!_deps) {
    _deps = {
      uow: new DrizzleUoW(),
      readOnly: new DrizzleReadOnly(),
    };
  }
  return _deps;
}
