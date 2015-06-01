#!/bin/sh

strings $@ | grep "^\{" | tail -n +2
