#!/bin/env python

import re
import sys

with sys.stdin as stdin:
    for line in stdin:
        escaped = re.escape(line.rstrip())
        print(escaped.replace("/", "\\/"))