---
title: "HTTP Connections & Feeds"
urlstring: "http-connections-and-feeds"
summary: "How to create HTTP Connections and Feeds"
---

## Connections and HTTP
Connections, specify the connection to a web service. You can have as many HTTP connections as you want, and each HTTP feed selects which connection it uses. You can make both HTTP & HTTPS connections.

If you are going to use HTTP, generally you will use port 80. If you are going to use HTTPS, use port 443.

## Creating a connection

{{>DocTable "HTTPConnectionProperties"}}

## Creating HTTP Feeds

HTTP Feeds specify the URL path part of a web service API and how it should be processed, as well as IF the service should be polled and at what interval.

## HTTP Feed Processing
Web services differ greatly in how they can be accessed, so HTTP Feeds allow you to specify functions which define how the outgoing request (request processors) and the incoming response (response processors) are formatted. The system provides two basic feeds processors, JSONIn and JSONOut. JSONOut sends data in the request in JSON format, and JSONIn attempts to parse the response as a JSON object.

You can write your own request and response processors for access legacy web services or those that have special access requirements, like special headers or authentication tokens.

To learn more about our feed processing system and writing custom feed processors, [read this doc](/docs/feed_processing).

{{>DocTable "HTTPFeedProperties"}}
