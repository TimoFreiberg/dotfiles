#!/bin/sh

if [ -n "$(lsusb | ag mouse)" ]; then
  echo pad off
  /usr/bin/synclient TouchpadOff=1
else
  echo pad on
  /usr/bin/synclient TouchpadOff=0
fi
