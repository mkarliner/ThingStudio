---
title: "HTTP Connections & Feeds"
urlstring: "http-connections-and-feeds"
summary: "How to create HTTP connections and Feeds"
---

## Connections and HTTP
Connections,  specify the connection to a web service.
You can have as many connections as you want, each HTTP feed selects which connection it uses.
## Creating a connection

{{>DocTable "HTTPConnectionProperties"}}


## Creating Feeds

Feeds specify the URL path part of a web service API and how is should be processed, and if the service should be polled and at what interval.

### Feed Processing
Web services differ greatly in how they can be accessed, so HTTP feeds allow you to specify how to format the outgoing request (requestProcessors) and the incoming response (responseProcessor). The system provides two basic feeds processors JSONin and JSONout. JSONout sends data in the request in JSON format, and JSONin attempts to parse the response as a JSON object. 
You can write your own request and response processors for access legacy webservices or those that have special access requirements, like special headers or authentication tokens.


{{>DocTable "HTTPFeedProperties"}}