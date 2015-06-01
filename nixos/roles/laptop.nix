
{ config, lib, pkgs, ... }:

{
  services.tlp.enable = true;
  services.xserver.libinput.enable = true;
}
