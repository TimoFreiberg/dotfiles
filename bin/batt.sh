#! /bin/sh
acpi | awk 'NR==1 {print $4}' | sed 's/,//g' | sed 's/%//g'
