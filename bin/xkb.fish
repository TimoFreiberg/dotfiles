#!/bin/env fish

function setUs
  setxkbmap -option ctrl:nocaps,lv3:ralt_switch us
  xmodmap ~/.Xmodmap
end 

if test -z $argv 
  setUs
else if test us = $argv
  setUs
else if test colemak = $argv
  setxkbmap us -variant colemak
else if test de = $argv
  setxkbmap de
else
  setUs
end

