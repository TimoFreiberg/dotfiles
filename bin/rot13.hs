#!/usr/bin/env stack
{- stack --resolver lts-8.12 --install-ghc
    runghc
-}

import Data.Char(toLower)
import System.Environment(getArgs)

main = getArgs >>= putStrLn . rot13 . unwords

rot13 :: String -> String
rot13 = fmap $ \c0 -> let c = toLower c0 in
    if c `elem` abc
      then head . drop 13 . dropWhile (/= c) . cycle $ abc
      else c
  where
    abc = ['a'..'z']
