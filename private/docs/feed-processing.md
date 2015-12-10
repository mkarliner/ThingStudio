---
title: "Feed Processing"
urlstring: "feed_processing"
summary: "Custom Feed Processors"	
---

##Basics
Feed processor are routines that change the data going in and out of a feed into a form that can be managed by the rest of ThingStudio.
There generally two types of feed processor for each transport, processors that manage incoming data, and processors that manage incoming data.

Feed processors need to be registered, that is, declared somewhere in your App's javascript. 
They are registered by a call to 'RegisterFeedProcessor', which takes the following parameters

__name__

This is the name which will be displayed in the select box when in the feed properties page.

__type__

There are generally two types of feed processor for each transport. For example,
for the HTTP transport, type can be HTTPRequest, or HTTPResponse, to process the outgoing
and incoming data respectively.



__function__

The actually function to be executed.

##HTTP Feed Processors
### Request Processors
HTTPRequest processors are called with parameters of __app__ the current app, __conn__ the connection, __feed__, __feed__, which is the feed that uses them,
and __message__ which is a JSON string to to be sent.

They should return an object which contains a property of __content__, which
contains the string to be sent, and, optionally, other HTTP specific options.
This makes use of the meteor HTTP.call function, details of which can be found
here http://docs.meteor.com/#/full/http_call. For convenience, here is a summary of the
options object.

content String
String to use as the HTTP request body.

data Object
JSON-able object to stringify and use as the HTTP request body. Overwrites content.

query String
Query string to go in the URL. Overwrites any query string in url.

params Object
Dictionary of request parameters to be encoded and placed in the URL (for GETs) or request body (for POSTs). If content or data is specified, params will always be placed in the URL.

auth String
HTTP basic authentication string of the form "username:password"

headers Object
Dictionary of strings, headers to add to the HTTP request.

timeout Number
Maximum time in milliseconds to wait for the request before failing. There is no timeout by default.

followRedirects Boolean
If true, transparently follow HTTP redirects. Cannot be set to false on the client. Default true.

npmRequestOptions Object
On the server, HTTP.call is implemented by using the npm request module. Any options in this object will be passed directly to the request invocation.

__Example__

RegisterFeedProcessor("testReq", "HTTPRequest", function(app, conn, feed, message){
	console.log("testReq Proc", feed, message);
	return ({
		content: message
	})
});



### Response Processors	
HTTPResponse processors manage the data coming back from the HTTP.call callback.
They are called with parameters of __app__ the current app, __conn__ the connection, __feed__, (the associated feed), __error__, any
error conditions, and __result__, which is the returned data. Again, details of the 
HTTP.call callback can be found here http://docs.meteor.com/#/full/http_call, but for convenience,
here are the contents of the result object:

Contents of the result object:

statusCode (Number)
Numeric HTTP result status code, or null on error.

content (String)
The body of the HTTP response as a string.

data (Object or null)
If the response headers indicate JSON content, this contains the body of the document parsed as a JSON object.

headers (Object)
A dictionary of HTTP headers from the response.

The Response Processor has no return value defined, but instead will have variable
effects, depending on its purpose. A basic feed processor will simply record the last
received message in the __Messages__ mini-mongo table as per the example below.


__Example__

	RegisterFeedProcessor("StdJSON", "HTTPResponse", function(app, conn, feed, error, result){
		console.log("RESPONSE: ", feed, error, result);
		if(error) {
			console.log("HRRPR: ", error.message );
			return;
		}
		try {
			payload = JSON.parse(result.content);
		}
		catch(err) {
			console.log("HERR: ", err);
			Session.set("runtimeErrors", "Invalid MQTT message, payload not JSON: " + result.content.toString());
			payload = result.content.toString();
		}
		console.log("payload", payload)
		Messages.upsert(
			{
				topic: feed.path,
				feed: feed.title
			},
			{$set:
				{
					feed: feed.title,
					topic: feed.path,
					payload: payload},
					$inc:{count: 1
				}
			});
	});
	
	
