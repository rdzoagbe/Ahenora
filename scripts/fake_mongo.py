"""In-memory, motor-compatible database for full-stack E2E simulation.

Lets the REAL backend/server.py run without a MongoDB instance: the journey
simulator patches `server.db` with FakeDatabase() and every handler runs its
actual code against this. Supports exactly the surface server.py uses:
find_one / insert_one / update_one / update_many / delete_one / delete_many /
count_documents / find().sort().limit() (async iteration + to_list), query
operators $exists $gt $gte $lt $lte $in $nin $ne $or $regex(+$options i), update
operators $set $inc, and db.command("ping").
"""

import re


def _match_condition(value, cond):
    if isinstance(cond, dict) and any(k.startswith("$") for k in cond):
        for op, arg in cond.items():
            if op == "$exists":
                if bool(value is not None) != bool(arg):
                    return False
            elif op == "$gt":
                if value is None or not value > arg:
                    return False
            elif op == "$gte":
                if value is None or not value >= arg:
                    return False
            elif op == "$lt":
                if value is None or not value < arg:
                    return False
            elif op == "$lte":
                if value is None or not value <= arg:
                    return False
            elif op == "$in":
                if value not in arg:
                    return False
            elif op == "$nin":
                if value in arg:
                    return False
            elif op == "$ne":
                if value == arg:
                    return False
            elif op == "$regex":
                flags = re.I if "i" in (cond.get("$options") or "") else 0
                if value is None or not re.search(arg, str(value), flags):
                    return False
            elif op == "$options":
                continue
            else:
                raise NotImplementedError(f"query operator {op}")
        return True
    return value == cond


def _matches(doc, query):
    for key, cond in (query or {}).items():
        if key == "$or":
            if not any(_matches(doc, sub) for sub in cond):
                return False
        else:
            if not _match_condition(doc.get(key), cond):
                return False
    return True


def _project(doc, projection):
    if not projection:
        return dict(doc)
    include = {k for k, v in projection.items() if v and k != "_id"}
    if include:
        return {k: v for k, v in doc.items() if k in include}
    exclude = {k for k, v in projection.items() if not v}
    return {k: v for k, v in doc.items() if k not in exclude}


class _Result:
    def __init__(self, matched=0, deleted=0):
        self.matched_count = matched
        self.modified_count = matched
        self.deleted_count = deleted


class _Cursor:
    def __init__(self, rows):
        self._rows = rows

    def sort(self, key, direction=1):
        # Missing keys sort last regardless of direction.
        present = [r for r in self._rows if r.get(key) is not None]
        missing = [r for r in self._rows if r.get(key) is None]
        present.sort(key=lambda r: r[key], reverse=direction == -1)
        self._rows = present + missing
        return self

    def limit(self, n):
        self._rows = self._rows[:n]
        return self

    async def to_list(self, n=None):
        return self._rows[:n] if n else list(self._rows)

    def __aiter__(self):
        async def gen():
            for row in self._rows:
                yield row
        return gen()


class FakeCollection:
    def __init__(self):
        self.rows = []

    async def find_one(self, query=None, projection=None):
        for row in self.rows:
            if _matches(row, query):
                return _project(row, projection)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return _Result(1)

    def _apply(self, row, update):
        for key, value in (update.get("$set") or {}).items():
            row[key] = value
        for key, value in (update.get("$inc") or {}).items():
            row[key] = (row.get(key) or 0) + value

    async def update_one(self, query, update, upsert=False):
        for row in self.rows:
            if _matches(row, query):
                self._apply(row, update)
                return _Result(1)
        if upsert:
            merged = {k: v for k, v in (query or {}).items() if not isinstance(v, dict)}
            self._apply(merged, update)
            self.rows.append(merged)
            return _Result(1)
        return _Result(0)

    async def update_many(self, query, update):
        n = 0
        for row in self.rows:
            if _matches(row, query):
                self._apply(row, update)
                n += 1
        return _Result(n)

    async def delete_one(self, query):
        for i, row in enumerate(self.rows):
            if _matches(row, query):
                del self.rows[i]
                return _Result(deleted=1)
        return _Result(deleted=0)

    async def delete_many(self, query):
        keep = [r for r in self.rows if not _matches(r, query)]
        deleted = len(self.rows) - len(keep)
        self.rows = keep
        return _Result(deleted=deleted)

    async def count_documents(self, query=None):
        return sum(1 for r in self.rows if _matches(r, query))

    def find(self, query=None, projection=None):
        return _Cursor([_project(r, projection) for r in self.rows if _matches(r, query)])


class FakeDatabase:
    def __init__(self):
        self._collections = {}

    def __getitem__(self, name):
        return self._collections.setdefault(name, FakeCollection())

    async def command(self, name):
        if name == "ping":
            return {"ok": 1}
        raise NotImplementedError(name)
