
{ config, lib, pkgs, ... }:

{
  programs.fish.enable = true;
  # Enable ZSH completion for system packages
  environment.pathsToLink = [ "/share/zsh" ];
}
